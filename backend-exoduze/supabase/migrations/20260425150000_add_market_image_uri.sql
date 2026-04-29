alter table markets
add column if not exists image_uri text;

create index if not exists idx_news_item_markets_market_relevance
on news_item_markets(market_id, relevance_score desc);
