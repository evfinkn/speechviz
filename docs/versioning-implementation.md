# Versioning

The interface saves a version history of changes made to annotations. This allows users
to revert to previous versions of annotations and to see who made changes and when.
We use [Fossil](https://fossil-scm.org/)—a distributed version control system similar to
Git—to manage the version history.

- [Versioning](#versioning)
  - [Implementation](#implementation)
    - [_app.js_](#appjs)
    - [Request endpoints](#request-endpoints)
    - [_fossil.js_](#fossiljs)
  - [Why Fossil?](#why-fossil)

## Implementation

Speechviz's server interfaces with Fossil through the `fossil` CLI.
_[fossil.js](server/fossil.js)_ is a wrapper around the `fossil` CLI that provides
functions for interacting with the version history. _[app.js](app.js)_ uses these
functions when handling requests. The `fossil` executable is installed (by
_[init_fossil.py](scripts/init_fossil.py)_) in the _data_ directory. The _data_
directory also contains the Fossil repository (named _speechviz.fossil_).

### _app.js_

When a user opens a file on the interface, the server checks if the file is in the
repository and if it has uncommitted changes.

- If the file is not in the repository, the server adds and commits it. This ensures
  that `GET /annotations/:file` will return the annotations instead of erroring because
  the file is not in the repository. This happens when a file has been processed for the
  1st time and hasn't been opened in the interface yet.
- If the file has uncommitted changes, the server commits them to ensure that
  `GET /annotations/:file` will return the latest version of the annotations. This
  happens when a file has been reprocessed and hasn't been opened in the interface
  since.

### Request endpoints

The following endpoints are used to interact with the version history:

- `GET /versions/:file` returns a list of versions for the given annotations file.
  "data/annotations/" is prepended to the file name, so the requested file should be
  relative to that directory. The following query parameters can be used to filter the
  versions returned:

  - `?limit=n` can be used to limit the number of versions returned. It defaults to -1
    (no limit).
  - `?branch=branch` can be used to only return versions on the given branch. When
    omitted, versions from all branches are returned.

  The response is a JSON array of objects containing info about each version. See
  _fossil.js_'s typedef `VersionEntry` for the format of each
  object. Examples of valid requests:

  - `GET /versions/example-annotations.json`
  - `GET /versions/subdir/file1.json?limit=1&branch=trunk`

  The high-level steps of this endpoint are:

  1. Add the file or commit its changes to the repository (if necessary) using
     `fossil add` or `fossil commit`, respectively.
  1. Get the version history of the file using _fossil.js_'s `versions` function.

- `GET /branch/list` returns a list of branches in the repository as a JSON array of
  strings.

- `GET /annotations/:file` returns the JSON contents of the file at a given version.
  The following query parameters specify which version of annotations to return:

  - `?commit=commit` specifies the version to return. It must be a valid Fossil commit
    hash.
  - `?branch=branch` can be used to return the latest version on the given branch.
    `?branch` is ignored when `?commit` is specified. When both `?commit` and `?branch`
    are omitted, the latest version of the file on any branch is returned.

  Examples of valid requests:

  - `GET /annotations/example-annotations.json?commit=3f4a4c`
  - `GET /annotations/subdir/file1.json?branch=trunk`

  The high-level steps of this endpoint are:

  1. Add the file or commit its changes to the repository (if necessary) using
     `fossil add` or `fossil commit`, respectively.
  1. Get the commit hash of the version to return, either from the `?commit` query
     parameter or by calling _fossil.js_'s `versions` function with the `?branch`
     query parameter if given.
  1. Get the contents of the file at the given commit using `fossil cat`.

- `POST /annotations/:file` commits annotations to the given file. The request body
  should be a JSON object containing the following properties:

  - `annotations`: The annotations to commit.
  - `branch`: The branch to commit to. If omitted, the commit is made to the current
    branch the server is on, which should always be the trunk branch.
  - `message`: The commit message.

  The response is a JSON object containing the info of the new version in the same
  format as the response of `GET /versions/:file`. Examples of valid requests:

  - `POST /annotations/example-annotations.json`
  - `POST /annotations/subdir/file1.json`

  The high-level steps of this endpoint are:

  1. Write the annotations to the file using `fs.createWriteStream`.
  1. Commit the file using `fossil commit`.
  1. Return the info of the new version by calling _fossil.js_'s `versions` function.

All requests will respond with error code 500 and the error message if an error occurs
while interacting with Fossil.

### _fossil.js_

Not all of Fossil's commands are wrapped in _[fossil.js](server/fossil.js)_, and some
of the commands that are wrapped don't support all of the options that the CLI supports.
The following Fossil commands are wrapped:

- `add`
- `commit` (used by `POST /annotations/:file`)
- `tag add`, `tag cancel`, `tag find`, and `tag list`
- `changes`
- `branch current` and `branch list` (the latter is used by `GET /branch/list`)
- `stash save`, `stash pop`, `stash apply`, and `stash goto`
- `update`
- `artifact`
- `cat` (used by `GET /annotations/:file`)
- `grep`

See _[fossil.js](server/fossil.js)_ for more documentation and the arguments of each
function. Fossil's CLI documentation can be found
[here](https://fossil-scm.org/home/help).

In addition to the above commands, _fossil.js_ provides the following functions:

- `hasChanges`: Returns `true` if the given files (or all files if omitted) have
  uncommitted changes.
- `withBranch`: Runs the given function with the given branch checked out.
- `withStash`: Runs the given function with changes stashed.
- `isInRepo`: Returns `true` if the given file has been added to the repository.
- `versions`: Returns a list of versions for the given file. This function is
  responsible for getting the version history for a file and is used by
  `GET /versions/:file`. It uses `fossil sql` to query the SQLite database that Fossil
  uses. See _[fossil-tables.md](queries/fossil-tables.md)_ for notes about the tables
  Fossil uses internally to store artifacts, commits, etc.
  _[views.sql](queries/views.sql)_ and _[getVersions.sql](queries/getVersions.sql)_
  are the SQL queries used by this function.

## Why Fossil?

Fossil has 2 main advantages over Git:

1. Fossil is a self-contained, stand-alone executable that is easy to install. Fossil
   also runs on Windows natively.
1. Fossil stores checkin objects in an SQLite database, which makes it easy to query
   the version history.
