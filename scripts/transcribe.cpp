// almost of this code comes from whisper.cpp examples/main/main.cpp
// https://github.com/ggerganov/whisper.cpp/blob/master/examples/main/main.cpp

#include "whisper.h"

// third-party utilities
// use your favorite implementations
#define DR_WAV_IMPLEMENTATION
#include "dr_wav.h"

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

// Terminal color map. 10 colors grouped in ranges [0.0, 0.1, ..., 0.9]
// Lowest is red, middle is yellow, highest is green.
const std::vector<std::string> k_colors = {
    "\033[38;5;196m", "\033[38;5;202m", "\033[38;5;208m", "\033[38;5;214m", "\033[38;5;220m",
    "\033[38;5;226m", "\033[38;5;190m", "\033[38;5;154m", "\033[38;5;118m", "\033[38;5;82m",
};

//  500 -> 00:05.000
// 6000 -> 01:00.000
std::string to_timestamp(int64_t t, bool comma = false) {
    int64_t msec = t * 10;
    int64_t hr = msec / (1000 * 60 * 60);
    msec = msec - hr * (1000 * 60 * 60);
    int64_t min = msec / (1000 * 60);
    msec = msec - min * (1000 * 60);
    int64_t sec = msec / 1000;
    msec = msec - sec * 1000;

    char buf[32];
    snprintf(buf, sizeof(buf), "%02d:%02d:%02d%s%03d", (int) hr, (int) min, (int) sec, comma ? "," : ".", (int) msec);

    return std::string(buf);
}

int timestamp_to_sample(int64_t t, int n_samples) {
    return std::max(0, std::min((int) n_samples - 1, (int) ((t*WHISPER_SAMPLE_RATE)/100)));
}

// helper function to replace substrings
void replace_all(std::string & s, const std::string & search, const std::string & replace) {
    for (size_t pos = 0; ; pos += replace.length()) {
        pos = s.find(search, pos);
        if (pos == std::string::npos) break;
        s.erase(pos, search.length());
        s.insert(pos, replace);
    }
}

// command-line parameters
struct whisper_params {
    int32_t n_threads    = std::min(4, (int32_t) std::thread::hardware_concurrency());
    int32_t n_processors = 1;
    int32_t offset_t_ms  = 0;
    int32_t offset_n     = 0;
    int32_t duration_ms  = 0;
    int32_t max_context  = -1;
    int32_t max_len      = 0;

    float word_thold = 0.01f;

    bool speed_up       = false;
    bool translate      = false;
    bool diarize        = false;
    bool output_txt     = false;
    bool output_vtt     = false;
    bool output_srt     = false;
    bool output_wts     = false;
    bool output_csv     = false;
    bool print_special  = false;
    bool print_colors   = false;
    bool print_progress = false;
    bool no_timestamps  = false;

    std::string language = "en";
    std::string prompt;
    std::string model    = "models/ggml-base.en.bin";

    std::vector<std::string> fname_inp = {};
};

void whisper_print_usage(int argc, char ** argv, const whisper_params & params);

bool whisper_params_parse(int argc, char ** argv, whisper_params & params) {
    for (int i = 1; i < argc; i++) {
        std::string arg = argv[i];

        if (arg[0] != '-') {
            params.fname_inp.push_back(arg);
            continue;
        }

        if (arg == "-h" || arg == "--help") {
            whisper_print_usage(argc, argv, params);
            exit(0);
        }
        else if (arg == "-t"    || arg == "--threads")        { params.n_threads      = std::stoi(argv[++i]); }
        else if (arg == "-p"    || arg == "--processors")     { params.n_processors   = std::stoi(argv[++i]); }
        else if (arg == "-ot"   || arg == "--offset-t")       { params.offset_t_ms    = std::stoi(argv[++i]); }
        else if (arg == "-on"   || arg == "--offset-n")       { params.offset_n       = std::stoi(argv[++i]); }
        else if (arg == "-d"    || arg == "--duration")       { params.duration_ms    = std::stoi(argv[++i]); }
        else if (arg == "-mc"   || arg == "--max-context")    { params.max_context    = std::stoi(argv[++i]); }
        else if (arg == "-ml"   || arg == "--max-len")        { params.max_len        = std::stoi(argv[++i]); }
        else if (arg == "-wt"   || arg == "--word-thold")     { params.word_thold     = std::stof(argv[++i]); }
        else if (arg == "-su"   || arg == "--speed-up")       { params.speed_up       = true; }
        else if (arg == "-tr"   || arg == "--translate")      { params.translate      = true; }
        else if (arg == "-di"   || arg == "--diarize")        { params.diarize        = true; }
        else if (arg == "-ps"   || arg == "--print-special")  { params.print_special  = true; }
        else if (arg == "-pc"   || arg == "--print-colors")   { params.print_colors   = true; }
        else if (arg == "-pp"   || arg == "--print-progress") { params.print_progress = true; }
        else if (arg == "-nt"   || arg == "--no-timestamps")  { params.no_timestamps  = true; }
        else if (arg == "-l"    || arg == "--language")       { params.language       = argv[++i]; }
        else if (                  arg == "--prompt")         { params.prompt         = argv[++i]; }
        else if (arg == "-m"    || arg == "--model")          { params.model          = argv[++i]; }
        else if (arg == "-f"    || arg == "--file")           { params.fname_inp.emplace_back(argv[++i]); }
        else {
            fprintf(stderr, "error: unknown argument: %s\n", arg.c_str());
            whisper_print_usage(argc, argv, params);
            exit(0);
        }
    }

    return true;
}

void whisper_print_usage(int /*argc*/, char ** argv, const whisper_params & params) {
    fprintf(stderr, "\n");
    fprintf(stderr, "usage: %s [options] file0.wav file1.wav ...\n", argv[0]);
    fprintf(stderr, "\n");
    fprintf(stderr, "options:\n");
    fprintf(stderr, "  -h,       --help           [default] show this help message and exit\n");
    fprintf(stderr, "  -t N,     --threads N      [%-7d] number of threads to use during computation\n",    params.n_threads);
    fprintf(stderr, "  -p N,     --processors N   [%-7d] number of processors to use during computation\n", params.n_processors);
    fprintf(stderr, "  -ot N,    --offset-t N     [%-7d] time offset in milliseconds\n",                    params.offset_t_ms);
    fprintf(stderr, "  -on N,    --offset-n N     [%-7d] segment index offset\n",                           params.offset_n);
    fprintf(stderr, "  -d  N,    --duration N     [%-7d] duration of audio to process in milliseconds\n",   params.duration_ms);
    fprintf(stderr, "  -mc N,    --max-context N  [%-7d] maximum number of text context tokens to store\n", params.max_context);
    fprintf(stderr, "  -ml N,    --max-len N      [%-7d] maximum segment length in characters\n",           params.max_len);
    fprintf(stderr, "  -wt N,    --word-thold N   [%-7.2f] word timestamp probability threshold\n",         params.word_thold);
    fprintf(stderr, "  -su,      --speed-up       [%-7s] speed up audio by x2 (reduced accuracy)\n",        params.speed_up ? "true" : "false");
    fprintf(stderr, "  -tr,      --translate      [%-7s] translate from source language to english\n",      params.translate ? "true" : "false");
    fprintf(stderr, "  -di,      --diarize        [%-7s] stereo audio diarization\n",                       params.diarize ? "true" : "false");
    fprintf(stderr, "  -ps,      --print-special  [%-7s] print special tokens\n",                           params.print_special ? "true" : "false");
    fprintf(stderr, "  -pc,      --print-colors   [%-7s] print colors\n",                                   params.print_colors ? "true" : "false");
    fprintf(stderr, "  -pp,      --print-progress [%-7s] print progress\n",                                 params.print_progress ? "true" : "false");
    fprintf(stderr, "  -nt,      --no-timestamps  [%-7s] do not print timestamps\n",                        params.no_timestamps ? "false" : "true");
    fprintf(stderr, "  -l LANG,  --language LANG  [%-7s] spoken language ('auto' for auto-detect)\n",       params.language.c_str());
    fprintf(stderr, "            --prompt PROMPT  [%-7s] initial prompt\n",                                 params.prompt.c_str());
    fprintf(stderr, "  -m FNAME, --model FNAME    [%-7s] model path\n",                                     params.model.c_str());
    fprintf(stderr, "  -f FNAME, --file FNAME     [%-7s] input WAV file path\n",                            "");
    fprintf(stderr, "\n");
}

bool output_transcription(struct whisper_context * ctx, const char * fname) {
    std::ofstream fout(fname);
    if (!fout.is_open()) {
        fprintf(stderr, "%s: failed to open '%s' for writing\n", __func__, fname);
        return false;
    }


    const int n_segments = whisper_full_n_segments(ctx);
    std::vector<std::pair<std::string, double>> words;
    words.reserve(n_segments);
    // i = 1 because first word is just empty string
    for (int i = 1; i < n_segments; ++i) {
        const double start = whisper_full_get_segment_t0(ctx, i);
        // const double end = whisper_full_get_segment_t1(ctx, i);
        // set the time of the word to the middle of the segment
        // and divide by 100 to get the time in seconds
        // const double time = (end + start) / 200; // == ((end + start) / 2) / 100
        const double time = start / 100;
        const char * text = whisper_full_get_segment_text(ctx, i);
        if (text[0] == ' ') {
            // whisper_full_get_segment_text() returns a string
            // with leading space, point to the next character.
	        text = text + sizeof(char);
            words.emplace_back(text, time);
        }
        else {
            const auto last = words.size() - 1;
            words[last].first = words[last].first + text;
        }
    }

    fout << "[";
    for (auto &word : words) {
        // fout << word.second << ", \"" << word.first << "\"\n";
        fout << "{\"labelText\": "
             << "\"" << word.first << "\", "
             << "\"time\": " << word.second << "}";
        if (word != words[n_segments - 1]) {
            fout << ", ";
        }
    }
    fout << "]";

    return true;
}

int main(int argc, char ** argv) {
    whisper_params params;

    if (whisper_params_parse(argc, argv, params) == false) {
        return 1;
    }

    if (params.fname_inp.empty()) {
        fprintf(stderr, "error: no input files specified\n");
        whisper_print_usage(argc, argv, params);
        return 2;
    }

    if (params.language != "auto" && whisper_lang_id(params.language.c_str()) == -1) {
        fprintf(stderr, "error: unknown language '%s'\n", params.language.c_str());
        whisper_print_usage(argc, argv, params);
        exit(0);
    }

    // whisper init

    struct whisper_context * ctx = whisper_init_from_file(params.model.c_str());

    if (ctx == nullptr) {
        fprintf(stderr, "error: failed to initialize whisper context\n");
        return 3;
    }

    // initial prompt
    std::vector<whisper_token> prompt_tokens;

    if (!params.prompt.empty()) {
        prompt_tokens.resize(1024);
        prompt_tokens.resize(whisper_tokenize(ctx, params.prompt.c_str(), prompt_tokens.data(), prompt_tokens.size()));

        fprintf(stderr, "\n");
        fprintf(stderr, "initial prompt: '%s'\n", params.prompt.c_str());
        fprintf(stderr, "initial tokens: [ ");
        for (int i = 0; i < (int) prompt_tokens.size(); ++i) {
            fprintf(stderr, "%d ", prompt_tokens[i]);
        }
        fprintf(stderr, "]\n");
    }

    for (int f = 0; f < (int) params.fname_inp.size(); ++f) {
        const auto fname_inp = params.fname_inp[f];
        const std::filesystem::path fpath(fname_inp);
        const auto grandparent = fpath.parent_path().parent_path();
        if (grandparent.stem() != "data") {
            throw std::invalid_argument("Files must be in a subdirectory of the data directory, but " + fpath.string() + " isn't");
        }

        std::vector<float> pcmf32; // mono-channel F32 PCM
        std::vector<std::vector<float>> pcmf32s; // stereo-channel F32 PCM

        // WAV input
        {
            drwav wav;
            std::vector<uint8_t> wav_data; // used for pipe input from stdin

            if (fname_inp == "-") {
                {
                    uint8_t buf[1024];
                    while (true)
                    {
                        const size_t n = fread(buf, 1, sizeof(buf), stdin);
                        if (n == 0) {
                            break;
                        }
                        wav_data.insert(wav_data.end(), buf, buf + n);
                    }
                }

                if (drwav_init_memory(&wav, wav_data.data(), wav_data.size(), nullptr) == false) {
                    fprintf(stderr, "error: failed to open WAV file from stdin\n");
                    return 4;
                }

                fprintf(stderr, "%s: read %zu bytes from stdin\n", __func__, wav_data.size());
            }
            else if (drwav_init_file(&wav, fname_inp.c_str(), nullptr) == false) {
                fprintf(stderr, "error: failed to open '%s' as WAV file\n", fname_inp.c_str());
                return 5;
            }

            if (wav.channels != 1 && wav.channels != 2) {
                fprintf(stderr, "%s: WAV file '%s' must be mono or stereo\n", argv[0], fname_inp.c_str());
                return 6;
            }

            if (params.diarize && wav.channels != 2 && params.no_timestamps == false) {
                fprintf(stderr, "%s: WAV file '%s' must be stereo for diarization and timestamps have to be enabled\n", argv[0], fname_inp.c_str());
                return 6;
            }

            if (wav.sampleRate != WHISPER_SAMPLE_RATE) {
                fprintf(stderr, "%s: WAV file '%s' must be %i kHz\n", argv[0], fname_inp.c_str(), WHISPER_SAMPLE_RATE/1000);
                return 8;
            }

            if (wav.bitsPerSample != 16) {
                fprintf(stderr, "%s: WAV file '%s' must be 16-bit\n", argv[0], fname_inp.c_str());
                return 9;
            }

            const uint64_t n = wav_data.empty() ? wav.totalPCMFrameCount : wav_data.size()/(wav.channels*wav.bitsPerSample/8);

            std::vector<int16_t> pcm16;
            pcm16.resize(n*wav.channels);
            drwav_read_pcm_frames_s16(&wav, n, pcm16.data());
            drwav_uninit(&wav);

            // convert to mono, float
            pcmf32.resize(n);
            if (wav.channels == 1) {
                for (uint64_t i = 0; i < n; i++) {
                    pcmf32[i] = float(pcm16[i])/32768.0f;
                }
            } else {
                for (uint64_t i = 0; i < n; i++) {
                    pcmf32[i] = float(pcm16[2*i] + pcm16[2*i + 1])/65536.0f;
                }
            }

            if (params.diarize) {
                // convert to stereo, float
                pcmf32s.resize(2);

                pcmf32s[0].resize(n);
                pcmf32s[1].resize(n);
                for (uint64_t i = 0; i < n; i++) {
                    pcmf32s[0][i] = float(pcm16[2*i])/32768.0f;
                    pcmf32s[1][i] = float(pcm16[2*i + 1])/32768.0f;
                }
            }
        }

        // run the inference
        {
            whisper_full_params wparams = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);

            wparams.print_realtime   = false;
            wparams.print_progress   = params.print_progress;
            wparams.print_timestamps = !params.no_timestamps;
            wparams.print_special    = params.print_special;
            wparams.translate        = params.translate;
            wparams.language         = params.language.c_str();
            wparams.n_threads        = params.n_threads;
            wparams.n_max_text_ctx   = params.max_context >= 0 ? params.max_context : wparams.n_max_text_ctx;
            wparams.offset_ms        = params.offset_t_ms;
            wparams.duration_ms      = params.duration_ms;

            wparams.token_timestamps = params.output_wts || params.max_len > 0;
            wparams.thold_pt         = params.word_thold;
            wparams.max_len          = params.output_wts && params.max_len == 0 ? 60 : params.max_len;

            wparams.speed_up         = params.speed_up;

            wparams.prompt_tokens    = prompt_tokens.empty() ? nullptr : prompt_tokens.data();
            wparams.prompt_n_tokens  = prompt_tokens.empty() ? 0       : prompt_tokens.size();

            // example for abort mechanism
            // in this example, we do not abort the processing, but we could if the flag is set to true
            // the callback is called before every encoder run - if it returns false, the processing is aborted
            {
                static bool is_aborted = false; // NOTE: this should be atomic to avoid data race

                wparams.encoder_begin_callback = [](struct whisper_context * /*ctx*/, void * user_data) {
                    bool is_aborted = *(bool*)user_data;
                    return !is_aborted;
                };
                wparams.encoder_begin_callback_user_data = &is_aborted;
            }

            if (whisper_full_parallel(ctx, wparams, pcmf32.data(), pcmf32.size(), params.n_processors) != 0) {
                fprintf(stderr, "%s: failed to process audio\n", argv[0]);
                return 10;
            }
        }

        // output stuff
        {
            const auto transcription = grandparent / "transcriptions";
            const auto out_filename = fpath.stem().string() + "-transcription.json";
            const auto out_path = transcription / out_filename;
            output_transcription(ctx, out_path.c_str());
        }
    }

    whisper_free(ctx);

    return 0;
}
