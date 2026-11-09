/** The official tool names, used everywhere in the UI. Change a name here and it changes across the app. */
export const TOOL_NAMES = {
  ideas: "AI Idea Generator",
  copy: "AI Copywriting",
  static: "AI Static Creative",
  script: "AI Script Writing",
  ugc: "AI UGC Video",
  edit: "AI Video Editing",
  landing: "AI Landing Pages",
  "media-buyer": "AI Media Buyer / Ads Agent",
  toast: "Toast / Meta Ads Analysis",
} as const;

export type ToolKey = keyof typeof TOOL_NAMES;
