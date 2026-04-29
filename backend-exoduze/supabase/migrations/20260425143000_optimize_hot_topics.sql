create index if not exists idx_hot_topic_snapshots_category_latest
on hot_topic_snapshots(window_type, category_id, window_end desc);

create index if not exists idx_hot_topic_snapshots_category_rank
on hot_topic_snapshots(window_type, category_id, window_end desc, heat_score desc, rank asc);

create index if not exists idx_topic_mention_timeseries_latest
on topic_mention_timeseries(topic_id, bucket_granularity, bucket_end_at desc);

create index if not exists idx_news_item_topics_topic_news_item
on news_item_topics(topic_id, news_item_id);
