const blockedImageHostPattern =
  "(finance\\.yahoo|yahoo|yimg|coin-images\\.coingecko\\.com|coingecko\\.com/coins/images|cryptoslate\\.com|theweek\\.in|usnews\\.com)";

const blockedImageTokenPattern =
  "(^|[/?&._=-])(logo|favicon|favico|icon|placeholder|default|avatar|sprite|blank|transparent|og)([/?&._=-]|$)";

export function usableImageWhereSql(
  imageRef: string,
  sourceSlugRef?: string,
  sourceNameRef?: string,
) {
  const sourceFilters =
    sourceSlugRef && sourceNameRef
      ? `
          AND ${sourceSlugRef} !~* 'yahoo'
          AND ${sourceNameRef} !~* 'yahoo'
        `
      : "";

  return `
    ${imageRef} IS NOT NULL
    AND btrim(${imageRef}) <> ''
    ${sourceFilters}
    AND ${imageRef} !~* '${blockedImageHostPattern}'
    AND ${imageRef} !~* '${blockedImageTokenPattern}'
  `;
}

export function usableImageExpressionSql(imageRef: string) {
  return `
    CASE
      WHEN ${usableImageWhereSql(imageRef)}
      THEN ${imageRef}
      ELSE NULL
    END
  `;
}

export function marketImageLateralSql(marketAlias = "m") {
  return `
    LEFT JOIN LATERAL (
      SELECT candidate.image_uri
      FROM (
        SELECT
          ni.image_uri,
          ns.slug AS source_slug,
          ns.name AS source_name,
          EXISTS (
            SELECT 1
            FROM market_topics mt
            JOIN news_item_topics nit ON nit.topic_id = mt.topic_id
            WHERE mt.market_id = ${marketAlias}.id
              AND mt.is_primary = true
              AND nit.news_item_id = ni.id
            LIMIT 1
          ) AS matches_primary_topic,
          COALESCE(nim.relevance_score, 0)::numeric AS relevance_score,
          nim.created_at,
          ni.published_at
        FROM news_item_markets nim
        JOIN news_items ni ON ni.id = nim.news_item_id
        JOIN news_sources ns ON ns.id = ni.source_id
        WHERE nim.market_id = ${marketAlias}.id
      ) candidate
      WHERE ${usableImageWhereSql("candidate.image_uri", "candidate.source_slug", "candidate.source_name")}
      ORDER BY
        candidate.matches_primary_topic DESC,
        candidate.relevance_score DESC,
        candidate.created_at ASC,
        candidate.published_at DESC
      LIMIT 1
    ) market_image ON true
  `;
}
