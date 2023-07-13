SELECT json_object(
    'uuid',
    -- artifact ID of the file
    uuid,
    'datetime',
    datetime(event.mtime, 'localtime', 'subsec'),
    -- maybe unixepoch should also get 'localtime'?
    'unixtime',
    unixepoch(event.mtime, 'subsec'),
    'branch',
    tagxref.value,
    'comment',
    coalesce(ecomment, comment),
    'user',
    coalesce(euser, user),
    'tags',
    (
      -- substr to remove the "sym-" prefix
      SELECT json_group_object(substr(tagname, 5), value)
      FROM tag,
        tagxref
        /* only show tags added by the user (not added internally by fossil) */
      WHERE tagname GLOB 'sym-*'
        AND tag.tagid = tagxref.tagid
        AND tagxref.rid = blob.rid
        AND tagxref.tagtype > 0
    )
  )
FROM tag
  CROSS JOIN event
  CROSS JOIN blob
  LEFT JOIN tagxref ON tagxref.tagid = tag.tagid
  AND tagxref.tagtype > 0
  AND tagxref.rid = blob.rid
WHERE blob.rid = event.objid
  AND tag.tagname = 'branch'
  AND (
    -- filter by branch
    :branch IS NULL -- if NULL, versions from all branches are returned
    OR tagxref.value IS NULL -- this shouldn't happen, but just in case
    OR tagxref.value = :branch -- only show versions from the specified branch
  )
  AND event.type = 'ci' -- only show checkins (commits)
  AND (
    :file IS NULL -- if NULL, versions of all files are returned
    OR EXISTS(
      -- filter by file name
      SELECT 1
      FROM mlink
      WHERE mlink.mid = event.objid
        AND mlink.fnid IN (
          SELECT fnid
          FROM filename
          WHERE name = :file COLLATE nocase
            /* if :file is a directory, return all files in that directory */
            OR lower(name) GLOB lower(:file || '/*')
        )
    )
  )
  AND (
    :version IS NULL -- if NULL, all versions are returned
    OR EXISTS(
      -- filter by version
      SElECT 1
      FROM tag,
        tagxref
      WHERE tag.tagname = 'sym-version'
        AND tag.tagid = tagxref.tagid
        AND tagxref.tagtype > 0
        AND tagxref.rid = blob.rid
        AND tagxref.value = :version
    )
  )
ORDER BY event.mtime DESC
