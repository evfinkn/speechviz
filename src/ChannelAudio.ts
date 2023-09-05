import { htmlToElement } from "./util";

const Channel = class Channel {
  /**
   * The name of the channel.
   * @type {string}
   */
  name;

  /**
   * The audio context for the channel.
   * @type {!AudioContext}
   */
  audioContext;

  /**
   * The gain node controlling the channel's volume.
   * @type {!GainNode}
   */
  gainNode;

  /**
   * The label element containing the channel name and inputs.
   * @type {!HTMLLabelElement}
   */
  label;

  /**
   * The slider element used to set the channel's volume.
   * @type {!HTMLInputElement}
   */
  slider;

  /**
   * The number input element used to set the channel's volume by typing.
   * @type {!HTMLInputElement}
   */
  input;

  /**
   * Whether the channel is muted.
   *
   * Note that this is not the same as `volume === 0`.
   * @type {boolean}
   */
  muted = false;

  /**
   * Whether the channel is muted because another channel is soloed.
   *
   * If any channel is soloed, all other channels are muted. This property is
   * separate from `muted` so that the channel will remember its muted state
   * when the soloed channel is no longer soloed.
   * @type {boolean}
   */
  mutedBySolo = false;

  /**
   * The button element for muting the channel.
   * @type {!HTMLButtonElement}
   */
  muteButton;

  /**
   * Whether the channel is soloed.
   *
   * A channel is soloed by clicking its solo button. If any channel is soloed,
   * all other channels are muted and its inputs are disabled.
   * @type {boolean}
   */
  soloed = false;

  /**
   * The button element for soloing the channel.
   * @type {!HTMLButtonElement}
   */
  soloButton;

  #scale = 1;

  /**
   * Scale factor for the channel's volume.
   *
   * `this.volume` is multiplied by this value before being sent to the gain node.
   * @type {number}
   */
  get scale() {
    return this.#scale;
  }

  set scale(value) {
    this.#scale = value;
    this.volume = this.slider.value; // reset the volume to apply the new scale
  }

  /**
   * The volume of the channel as a percentage.
   * @type {number}
   */
  get volume() {
    // use the slider value when the channel isn't muted because the gain node
    // uses the scaled value
    return this.muted ? 0 : this.slider.value;
  }

  set volume(value) {
    if (!this.muted) {
      this.gainNode.gain.value = (value / 100) * this.scale;
    }
    this.slider.value = value;
    this.input.value = value;
  }

  /**
   * The step size for the channel's volume.
   *
   * The value is a percentage and defaults to 1. It corresponds to the `step`
   * attribute of `slider` and `input`.
   * @type {number}
   */
  get volumeStep() {
    return this.slider.step;
  }

  set volumeStep(value) {
    this.slider.step = value;
    this.input.step = value;
  }

  /**
   * The maximum volume of the channel.
   *
   * The value is a percentage and defaults to 100. It corresponds to the `max`
   * attribute of `slider` and `input`.
   * @type {number}
   */
  get volumeMax() {
    return this.slider.max;
  }

  set volumeMax(value) {
    this.slider.max = value;
    this.input.max = value;
  }

  constructor(
    name,
    audioContext,
    { volume = 100, volumeStep = 1, volumeMax = 100 } = {}
  ) {
    this.name = name;
    this.audioContext = audioContext;

    this.gainNode = audioContext.createGain();
    this.gainNode.gain.value = volume / 100;

    this.label = htmlToElement(`<label>${name}</label>`);
    this.slider = htmlToElement(`<input
      type="range"
      min="0"
      max="${volumeMax}"
      value="${volume}"
      step="${volumeStep}"
      list="volume-ticks"
    />`);
    this.input = htmlToElement(`<input
      class="volume-input"
      type="number"
      min="0"
      max="${volumeMax}"
      value="${volume}"
      step="${volumeStep}"
    />`);

    this.slider.addEventListener(
      "input",
      () => (this.volume = this.slider.value)
    );
    this.input.addEventListener(
      "input",
      () => (this.volume = this.input.value)
    );

    this.muteButton = htmlToElement("<button>Mute</button>");
    this.muteButton.addEventListener("click", () => {
      if (this.muted) {
        this.unmute();
      } else {
        this.mute();
      }
    });

    this.soloButton = htmlToElement("<button>Solo</button>");

    this.label.append(
      this.slider,
      this.input,
      this.muteButton,
      this.soloButton
    );
  }

  mute(bySolo = false) {
    if (bySolo) {
      this.mutedBySolo = true;
    } else {
      this.muteButton.classList.add("pressed");
      this.muted = true;
    }
    this.gainNode.gain.value = 0;
    this.slider.disabled = true;
    this.input.disabled = true;
  }

  unmute(bySolo = false) {
    if (bySolo) {
      this.mutedBySolo = false;
    } else {
      this.muteButton.classList.remove("pressed");
      this.muted = false;
    }
    if (!this.muted && !this.mutedBySolo) {
      this.volume = this.slider.value;
      this.slider.disabled = false;
      this.input.disabled = false;
    }
  }

  solo() {
    this.soloed = true;
    this.soloButton.classList.add("pressed");
    this.mutedBySolo = false;
    this.unmute();
  }

  unsolo() {
    this.soloed = false;
    this.soloButton.classList.remove("pressed");
  }

  connect(destination, ...args) {
    this.gainNode.connect(destination, ...args);
  }
};

const Channels = class Channels {
  div;
  audioContext;
  source;
  channels;
  splitter;
  output;

  constructor(audioContext, source, channelNames, channelOptions = {}) {
    this.div = document.createElement("div");
    this.audioContext = audioContext;
    this.source = source;

    this.channels = channelNames.map(
      (name) => new Channel(name, audioContext, channelOptions)
    );
    this.splitter = audioContext.createChannelSplitter(channelNames.length);

    this.source.connect(this.splitter);
    this.channels.forEach((channel, i) => {
      this.splitter.connect(channel.gainNode, i);

      channel.soloButton.addEventListener("click", () => {
        if (channel.soloed) {
          channel.unsolo();
          this.unmuteAll(true);
        } else {
          this.channels.forEach((c) => c.unsolo());
          this.muteAll([channel], true);
          channel.solo();
        }
      });

      this.div.append(channel.label);
      this.div.append(document.createElement("br"));
    });

    const grouped = this.#groupForMerging(this.channels);
    this.output = this.#scaleAndMerge(grouped, grouped.length);
  }

  // Returns a (possibly nested) array of nodes to be merged
  // Each element of the array is either a node or an array of nodes. The array
  // (and subarrays) are groups of nodes to be merged together.
  #groupForMerging(nodes) {
    nodes = [...nodes]; // copy the array so we don't modify the original
    // it shouldn't happen, but nodes only has one element, nest it in an array
    // so that nodes[0] is always an array
    if (nodes.length === 1) {
      nodes = [nodes];
    }
    while (nodes.length > 1) {
      if (nodes.length >= 4) {
        nodes.push(nodes.splice(-4));
      } else {
        nodes.push(nodes.splice(-2));
      }
    }
    return nodes[0];
  }

  #scaleAndMerge(grouped, factor) {
    const merger = this.audioContext.createChannelMerger(grouped.length);
    grouped.forEach((item, i) => {
      if (Array.isArray(item)) {
        const merged = this.#scaleAndMerge(item, factor * item.length);
        merged.connect(merger, 0, i);
      } else {
        item.scale *= factor;
        item.connect(merger, 0, i);
      }
    });
    return merger;
  }

  muteAll(except = [], bySolo = false) {
    this.channels.forEach((channel) => {
      if (!except.includes(channel)) {
        channel.mute(bySolo);
      }
    });
  }

  unmuteAll(bySolo = false) {
    this.channels.forEach((channel) => channel.unmute(bySolo));
  }
};

export { Channel, Channels };
