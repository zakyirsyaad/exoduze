export type NormalizedFeedItem = {
  sourceName: string;
  sourceUrl?: string | undefined;
  title: string;
  summary?: string | undefined;
  url: string;
  imageUri?: string | undefined;
  publishedAt: string;
  isBreaking: boolean;
  mentionWeight: number;
  rawPayload: unknown;
};
