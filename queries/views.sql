-- prefix name with spchviz_ to avoid name collisions
-- spchviz_tag contains all tags and their values
CREATE VIEW IF NOT EXISTS spchviz_tag AS
SELECT tagxref.rid,
  tag.tagname,
  tagxref.value
FROM tag
  INNER JOIN tagxref ON tagxref.tagid = tag.tagid
  AND tagxref.tagtype > 0;
--
--
-- spchviz_user_tag contains only tags added by the user (except for the tag fossil adds
-- for the branch name, e.g., "sym-trunk")
CREATE VIEW IF NOT EXISTS spchviz_user_tag AS
SELECT tagxref.rid,
  -- substr to remove the "sym-" prefix
  substr(tag.tagname, 5) AS tagname,
  tagxref.value
FROM tag
  INNER JOIN tagxref ON tagxref.tagid = tag.tagid
  AND tagxref.tagtype > 0
  /* fossil adds 'sym-' prefix to tags added by the user so only select those */
WHERE tag.tagname GLOB 'sym-*';
--
--
-- spchviz_artifact contains all the information needed to display a version of a file
CREATE VIEW IF NOT EXISTS spchviz_artifact AS
/* artifact.rid = blobci.rid = event.objid = mlink.mid = tagxref.rid */
SELECT blobci.rid,
  filename.name AS file,
  -- the hash of the file at the time of the commit (sometimes called the artifact id)
  blobfile.uuid AS fid,
  -- the hash of the commit
  blobci.uuid AS cid,
  -- in the WHERE clause, we filter so that tag.tagname = 'branch'
  -- meaning that spchviz_tag.value will be the branch name
  spchviz_tag.value AS branch,
  coalesce(event.ecomment, event.comment) AS comment,
  coalesce(event.euser, event.user) AS user,
  event.mtime
FROM blob AS blobci -- blob of the commit
  INNER JOIN event ON event.objid = blobci.rid
  INNER JOIN mlink ON mlink.mid = blobci.rid
  INNER JOIN filename ON filename.fnid = mlink.fnid
  INNER JOIN blob AS blobfile ON blobfile.rid = mlink.fid -- blob of the file
  INNER JOIN spchviz_tag ON spchviz_tag.rid = blobci.rid
WHERE event.type = 'ci' -- we only want commits (ci = checkin)
  AND spchviz_tag.tagname = 'branch';
