// All the knobs live here. Change values, redeploy, done.
// To add a niche later: add another object to `channels`.

const FLASH = "gemini-2.5-flash";
const LITE = "gemini-2.5-flash-lite";

export const CONFIG = {
  site: {
    name: "PromptNest",
    tagline: "Practical AI tool guides for beginners and freelancers",
    author: "PromptNest Editorial Team",
    lang: "en-IN",
  },

  gemini: {
    // Each role tries the models in order. If one is out of quota it moves to the next.
    // Google changes model names and free limits often. Check ai.google.dev and edit these.
    models: {
      topic: [LITE, FLASH],
      research: [FLASH, LITE],
      writer: [FLASH, LITE],
      checker1: [FLASH, LITE],
      checker2: [LITE, FLASH], // deliberately a different model first
      seo: [LITE, FLASH],
    },
    // Hard daily cap on Gemini requests (counted by this tool, IST day).
    // Keep it below your real free-tier limit.
    dailyCallCap: 150,
    reserveCalls: 10, // never spend the last few calls
    callsPerPost: 10, // a full post uses about 9-10 calls
  },

  // Pipeline safety
  maxStagesPerTick: 4,
  maxSubrequestsPerTick: 35,
  maxStageFailures: 3, // a stage that fails this many times marks the job failed
  autoPauseAfterFailedJobs: 3, // failed jobs in 24h before the tool pauses itself
  autoPublish: false, // keep false until you trust the quality

  channels: [
    {
      id: "ai-tools",
      name: "AI Tools",
      audience:
        "beginners and freelancers in India who want to use AI tools to save time, deliver better client work and earn more",
      voice:
        "a seasoned practitioner and teacher: calm, precise, warm, practical. Explains why before how. Uses plain words, concrete examples and short paragraphs. Never hypes. Admits limits and trade-offs.",
      feeds: [
        "https://blog.google/technology/ai/rss/",
        "https://openai.com/news/rss.xml",
        "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
        "https://techcrunch.com/category/artificial-intelligence/feed/",
      ],
      categories: [
        "AI Tools",
        "Freelancing with AI",
        "Prompts and How-To",
        "Tool Comparisons",
        "AI News Explained",
      ],
      topicHints: [
        "step-by-step guides for a specific AI tool a freelancer can use for client work",
        "free vs paid comparisons of popular AI tools",
        "how a beginner can do a specific job (resume, logo, video script, proposal, research) with AI",
        "news about an AI tool explained for beginners: what changed and what to do about it",
      ],
      minWords: 1300,
      maxWords: 2000,
      targetPostsPerDay: 2,
      maxPostsPerDay: 3,
    },
  ],

  // Phrases that make writing sound machine-made. Posts containing them get a warning.
  banned: [
    "in today's fast-paced world",
    "in the ever-evolving",
    "delve",
    "unlock the power",
    "game-changer",
    "game changer",
    "revolutionize",
    "it's important to note",
    "in the realm of",
    "tapestry",
    "navigating the landscape",
    "look no further",
  ],
};
