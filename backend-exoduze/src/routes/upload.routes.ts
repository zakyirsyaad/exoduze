import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";

import type { Env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";

const maxAgentAvatarBytes = 2 * 1024 * 1024;

const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"]
]);

export async function registerUploadRoutes(app: FastifyInstance, env: Env) {
  app.post("/v1/uploads/agent-avatar", async (request, reply) => {
    const auth = app.requireAuth(request, reply);
    if (!auth) {
      return;
    }

    if (!request.isMultipart()) {
      throw new HttpError(415, "MULTIPART_REQUIRED", "Upload request must use multipart/form-data.");
    }

    const file = await request.file({
      throwFileSizeLimit: false,
      limits: {
        files: 1,
        fileSize: maxAgentAvatarBytes,
        parts: 1
      }
    });

    if (!file) {
      throw new HttpError(400, "UPLOAD_FILE_REQUIRED", "A file field is required.");
    }

    const extension = allowedImageTypes.get(file.mimetype);
    if (!extension) {
      await drainFile(file.file);
      throw new HttpError(415, "UNSUPPORTED_AVATAR_TYPE", "Avatar must be a JPEG, PNG, WebP, or GIF image.");
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch {
      throw new HttpError(413, "AVATAR_FILE_TOO_LARGE", "Avatar file must be 2MB or smaller.");
    }

    if (file.file.truncated || buffer.length > maxAgentAvatarBytes) {
      throw new HttpError(413, "AVATAR_FILE_TOO_LARGE", "Avatar file must be 2MB or smaller.");
    }

    const supabase = createSupabaseStorageClient(env);
    const filename = `${randomUUID()}.${extension}`;
    const objectPath = `${auth.walletAddress}/${filename}`;
    const bucket = env.SUPABASE_AGENT_AVATARS_BUCKET;
    const { data, error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
      cacheControl: "31536000",
      contentType: file.mimetype,
      upsert: false
    });

    if (error) {
      throw new HttpError(502, "AVATAR_STORAGE_UPLOAD_FAILED", error.message);
    }

    const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(data.path);

    reply.code(201);
    return {
      data: {
        filename,
        content_type: file.mimetype,
        bucket,
        path: data.path,
        full_path: data.fullPath,
        size_limit_bytes: maxAgentAvatarBytes,
        avatar_uri: publicUrlData.publicUrl
      }
    };
  });
}

async function drainFile(stream: NodeJS.ReadableStream) {
  await pipeline(
    stream,
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      }
    })
  );
}

function createSupabaseStorageClient(env: Env): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new HttpError(
      500,
      "SUPABASE_STORAGE_NOT_CONFIGURED",
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured before uploading agent avatars."
    );
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
