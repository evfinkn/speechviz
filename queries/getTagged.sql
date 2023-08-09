-- this query is meant to replicate the behavior of `fossil tag find`, except that it
-- always outputs checkin hashes instead of only doing that when --raw is specified
SELECT blob.uuid
FROM blob
    INNER JOIN spchviz_tag ON spchviz_tag.rid = blob.rid
    INNER JOIN event ON event.objid = blob.rid
WHERE event.type GLOB coalesce(:type, '*') -- if :type is null, match all types
    AND spchviz_tag.tagname = (
        CASE
            -- coalesce because if :raw is null, :raw != 1 returns null instead of true
            WHEN coalesce(:raw, 0) != 1
            /* only prepend 'sym-' if we're looking for commits, which is how
             * `fossil tag find` behaves */
            AND :type = 'ci' THEN 'sym-' || :tagname
            ELSE :tagname
        END
    )
ORDER BY event.mtime DESC
LIMIT coalesce(:limit, -1)
