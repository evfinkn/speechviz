## Fossil tables

This file contains notes about the tables Fossil uses internally to store artifacts,
commits, etc. These notes are based on the output of `fossil sql readonly ".schema"`,
which shows the schema of all tables (or `fossil sql readonly ".schema example"`, which
shows the schema of the table named "example"), the output of `fossil timeline --sql`
(along with other options) which shows the SQL that Fossil uses to generate the
timeline, and educated guesses based on the names of the columns and the source code.
Some tables and their columns are pretty self-explanatory, but I've included them
anyway for completeness. I've only included tables and columns that I used and that
I think are useful.

### filename

Stores file names. Notable columns:

- fnid: id of the name
- name: the file's name

### mlink

Stores the relationship between a commit and the files that were changed in
that commit. Notable columns:

- mid: blob.rid of the commit
- fid: blob.rid of the file at the time of the commit
- fnid: file's name's id, REFERENCES filename

### tag

Stores tag names. Notable columns:

- tagid: id of the tag
- tagname: the name of the tag

### tagxref

Stores the relationship between a tag and a commit. Notable columns:

- tagid: REFERENCES tag.tagid
- tagtype: int identifying the type of the tag which I believe is one of cancel,
  singleton, or propagated. My educated guess is that 0 = cancel since the SQL
  fossil generated used tagxref.tagtype > 0 when looking for tags
- rid: blob.rid of the commit the tag is on, REFERENCES blob.rid
- value: the value of the tag (or NULL if the tag has no value)

### blob

Stores hashes and contents of artifacts (mainly commits and files). Notable columns:

- rid: the row id of the artifact. Used to reference the artifact from other tables
- uuid: the hash that uniquely identifies the artifact
- content: the contents of the artifact. The content is stored compressed and
  deltaed. If using `fossil sql`, you can use the `content(artifact)` function
  to get the uncompressed content of the artifact

### event

Stores events (mainly commits, also tag edits). Notable columns:

- type: the event type. One of ci (checkin), w (wiki), e (event/technote),
  f (forum post), t (ticket), or g (tag)
- objid: blob.rid of the artifact that the event is about
- mtime: the time that the event happened
- user: user that did the event (e.g., user that made the commit)
- comment: comment of the event (e.g., commit message) (fossil sets this itself
  for events like when a tag is added)
- euser, ecomment: not sure, usually NULL.
