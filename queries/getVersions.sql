-- Some comments use /* */ instead of -- because the autoformatter keeps /* */ comments
-- on their own line (it moves some -- comments to the end of the previous line)
SELECT json_object(
    'file',
    artifact.file,
    'id',
    artifact.fid,
    'commit',
    artifact.cid,
    'branch',
    artifact.branch,
    'message',
    artifact.comment,
    'user',
    artifact.user,
    'datetime',
    datetime(artifact.mtime),
    'unixtime',
    unixepoch(artifact.mtime),
    'tags',
    (
      SELECT json_group_object(tag.tagname, tag.value)
      FROM spchviz_user_tag AS tag
      WHERE tag.rid = artifact.rid
        /* fossil adds the branch name as a tag, but we don't need it */
        AND tag.tagname != artifact.branch
    )
  )
FROM spchviz_artifact AS artifact
WHERE (
    :branch IS NULL -- if NULL, versions from all branches are returned
    OR artifact.branch = :branch -- only show versions from the specified branch
  )
  AND (
    :file IS NULL -- if NULL, entries for all files are returned
    /* if :file is a file, only return entries for that file */
    OR artifact.file = :file COLLATE nocase
    /* if :file is a directory, return entries for all files in it */
    -- OR lower(artifact.file) GLOB lower(:file || '/*')
  )
ORDER BY artifact.mtime DESC
LIMIT coalesce(:limit, -1) -- -1 means no limit
