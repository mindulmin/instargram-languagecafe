const assert = require("node:assert/strict");
const test = require("node:test");
const { GraphApiRequestError, graphRequest } = require("./carousel-pipeline.cjs");

const config = { graphVersion: "v23.0", accountId: "ig-user", accessToken: "test-token" };

test("carousel image children send only image_url and carousel flag", { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: "child-container" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    await graphRequest(config, "media", "POST", {
      image_url: "https://example.com/card-01.png",
      is_carousel_item: "true"
    }, {
      operation: "create_carousel_image_child",
      stage: "creating_instagram_children",
      childIndex: 1,
      mediaUrl: "https://example.com/card-01.png"
    });
  } finally {
    global.fetch = originalFetch;
  }

  const form = new URLSearchParams(request.options.body);
  assert.equal(form.get("image_url"), "https://example.com/card-01.png");
  assert.equal(form.get("is_carousel_item"), "true");
  assert.equal(form.has("media_type"), false);
});

test("Graph failures retain child and Meta error details without tokens", { concurrency: false }, async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    error: {
      message: "Unsupported media",
      type: "OAuthException",
      code: 100,
      error_subcode: 2207001,
      error_user_title: "Image rejected",
      error_user_msg: "Use a public image URL.",
      fbtrace_id: "trace-id"
    }
  }), { status: 400, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(
      () => graphRequest(config, "media", "POST", { image_url: "https://example.com/card-02.png" }, {
        operation: "create_carousel_image_child",
        stage: "creating_instagram_children",
        childIndex: 2,
        mediaUrl: "https://example.com/card-02.png"
      }),
      (error) => {
        assert.equal(error instanceof GraphApiRequestError, true);
        assert.deepEqual(error.details, {
          httpStatus: 400,
          path: "media",
          method: "POST",
          operation: "create_carousel_image_child",
          stage: "creating_instagram_children",
          childIndex: 2,
          mediaUrl: "https://example.com/card-02.png",
          code: 100,
          errorSubcode: 2207001,
          type: "OAuthException",
          errorUserTitle: "Image rejected",
          errorUserMessage: "Use a public image URL.",
          fbtraceId: "trace-id"
        });
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }
});
