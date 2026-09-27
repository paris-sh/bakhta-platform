import assert from "node:assert/strict";
import { test } from "node:test";
import { youtubeVideoId } from "./youtube.ts";

test("extracts the video id from YouTube live, watch and short links", () => {
  assert.equal(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(youtubeVideoId("https://youtube.com/live/AbC_12-xyZ9?feature=share"), "AbC_12-xyZ9");
  assert.equal(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=5"), "dQw4w9WgXcQ");
  assert.equal(youtubeVideoId("  https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x "), "dQw4w9WgXcQ");
});

test("rejects anything that is not an https YouTube video link", () => {
  assert.equal(youtubeVideoId("http://www.youtube.com/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeVideoId("https://vimeo.com/123456789"), null);
  assert.equal(youtubeVideoId("https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(youtubeVideoId("https://www.youtube.com/channel/UCabc"), null);
  assert.equal(youtubeVideoId("not a url"), null);
});
