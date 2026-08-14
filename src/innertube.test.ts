import assert from "node:assert/strict";
import test from "node:test";
import { extractPlaylistPage, playlistEditActions, playlistEditSucceeded } from "./innertube.ts";
import { isWatchLaterUrl } from "./shared.ts";

const classicPage = {
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          playlistVideoListRenderer: {
                            contents: [
                              {
                                playlistVideoRenderer: {
                                  videoId: "abcdefghijk",
                                  setVideoId: "set-old",
                                  title: { runs: [{ text: "Old video" }] },
                                  publishedTimeText: { simpleText: "3 years ago" },
                                  videoInfo: {
                                    runs: [{ text: "1.2M views" }, { text: " • " }, { text: "3 years ago" }],
                                  },
                                },
                              },
                              {
                                playlistVideoRenderer: {
                                  videoId: "newervideo1",
                                  setVideoId: "set-new",
                                  title: { simpleText: "Recent upload" },
                                  publishedTimeText: { simpleText: "2 days ago" },
                                },
                              },
                              {
                                continuationItemRenderer: {
                                  continuationEndpoint: {
                                    continuationCommand: { token: "CONT_TOKEN_1" },
                                  },
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
    twoColumnWatchNextResults: {
      secondaryResults: {
        secondaryResults: {
          results: [
            {
              compactVideoRenderer: {
                videoId: "sidebarnoway",
                title: { simpleText: "Suggested" },
                publishedTimeText: { simpleText: "8 years ago" },
              },
            },
          ],
        },
      },
    },
  },
};

const lockupContinuation = {
  onResponseReceivedActions: [
    {
      appendContinuationItemsAction: {
        continuationItems: [
          {
            richItemRenderer: {
              content: {
                lockupViewModel: {
                  contentId: "lmnopqrstuv",
                  contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
                  metadata: {
                    lockupMetadataViewModel: {
                      title: { content: "Lockup video" },
                      metadata: {
                        contentMetadataViewModel: {
                          metadataRows: [
                            {
                              metadataParts: [{ text: { content: "2 years ago" } }],
                            },
                          ],
                        },
                      },
                    },
                  },
                  rendererContext: {
                    commandContext: {
                      onTap: {
                        innertubeCommand: {
                          playlistEditEndpoint: {
                            actions: [{ setVideoId: "set-lockup" }],
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  ],
};

test("reads classic Watch Later rows and ignores sidebar videos", () => {
  const page = extractPlaylistPage(classicPage);
  assert.deepEqual(
    page.items.map((item) => item.videoId),
    ["abcdefghijk", "newervideo1"],
  );
  assert.equal(page.items[0].title, "Old video");
  assert.equal(page.items[0].setVideoId, "set-old");
  assert.ok(page.items[0].dateTexts.includes("3 years ago"));
  assert.equal(page.continuation, "CONT_TOKEN_1");
});

test("reads lockup continuation rows and setVideoId", () => {
  const page = extractPlaylistPage(lockupContinuation);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].videoId, "lmnopqrstuv");
  assert.equal(page.items[0].title, "Lockup video");
  assert.equal(page.items[0].setVideoId, "set-lockup");
  assert.ok(page.items[0].dateTexts.includes("2 years ago"));
  assert.equal(page.continuation, null);
});

test("builds remove actions, preferring setVideoId", () => {
  assert.deepEqual(
    playlistEditActions([
      { videoId: "abcdefghijk", setVideoId: "set-old" },
      { videoId: "newervideo1", setVideoId: null },
    ]),
    [
      { action: "ACTION_REMOVE_VIDEO", setVideoId: "set-old", removedVideoId: "abcdefghijk" },
      { action: "ACTION_REMOVE_VIDEO_BY_VIDEO_ID", removedVideoId: "newervideo1" },
    ],
  );
});

test("only treats STATUS_SUCCEEDED as a confirmed edit", () => {
  assert.equal(playlistEditSucceeded({ status: "STATUS_SUCCEEDED" }), true);
  assert.equal(playlistEditSucceeded({ status: "STATUS_SUCCEEDED", error: {} }), false);
  assert.equal(playlistEditSucceeded({ status: "STATUS_FAILED" }), false);
  assert.equal(playlistEditSucceeded({}), false);
});

test("ignores continuation tokens from header-only lists", () => {
  const page = extractPlaylistPage({
    onResponseReceivedActions: [
      {
        reloadContinuationItemsCommand: {
          continuationItems: [
            {
              continuationItemRenderer: {
                continuationEndpoint: { continuationCommand: { token: "CHIPS_TOKEN" } },
              },
            },
          ],
        },
      },
      {
        appendContinuationItemsAction: {
          continuationItems: [
            {
              playlistVideoRenderer: {
                videoId: "abcdefghijk",
                setVideoId: "set-old",
                title: { simpleText: "Old video" },
                publishedTimeText: { simpleText: "3 years ago" },
              },
            },
            {
              continuationItemRenderer: {
                continuationEndpoint: { continuationCommand: { token: "VIDEO_TOKEN" } },
              },
            },
          ],
        },
      },
    ],
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.continuation, "VIDEO_TOKEN");
});

test("reads a rich-grid Watch Later page when rows carry setVideoId", () => {
  const page = extractPlaylistPage({
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                richGridRenderer: {
                  contents: [
                    {
                      richItemRenderer: {
                        content: {
                          lockupViewModel: {
                            contentId: "richgridvid",
                            contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
                            metadata: {
                              lockupMetadataViewModel: {
                                title: { content: "Grid video" },
                                metadata: {
                                  contentMetadataViewModel: {
                                    metadataRows: [{ metadataParts: [{ text: { content: "4 years ago" } }] }],
                                  },
                                },
                              },
                            },
                            extra: { playlistEditEndpoint: { actions: [{ setVideoId: "set-grid" }] } },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].videoId, "richgridvid");
  assert.equal(page.items[0].setVideoId, "set-grid");
});

test("only treats youtube.com playlist?list=WL as Watch Later", () => {
  assert.equal(isWatchLaterUrl("https://www.youtube.com/playlist?list=WL"), true);
  assert.equal(isWatchLaterUrl("https://www.youtube.com/playlist?list=PLother"), false);
  assert.equal(isWatchLaterUrl("https://evilyoutube.com/playlist?list=WL"), false);
});
