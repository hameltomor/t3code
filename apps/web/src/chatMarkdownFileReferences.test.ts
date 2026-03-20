import { describe, expect, it } from "vitest";

import { linkifyInlineCodeFileReferences } from "./chatMarkdownFileReferences";

describe("linkifyInlineCodeFileReferences", () => {
  it("wraps inline code file references in markdown links", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "See " },
            { type: "inlineCode", value: "apps/web/src/components/ChatView.tsx" },
          ],
        },
      ],
    };

    linkifyInlineCodeFileReferences(tree, "/repo");

    expect(tree.children?.[0]?.children?.[1]).toEqual({
      type: "link",
      url: "apps/web/src/components/ChatView.tsx",
      children: [{ type: "inlineCode", value: "apps/web/src/components/ChatView.tsx" }],
    });
  });

  it("keeps non-file inline code unchanged", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "inlineCode", value: "working_hours = truck.hours" }],
        },
      ],
    };

    linkifyInlineCodeFileReferences(tree, "/repo");

    expect(tree.children?.[0]?.children?.[0]).toEqual({
      type: "inlineCode",
      value: "working_hours = truck.hours",
    });
  });

  it("does not create nested links", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "apps/web/src/components/ChatView.tsx",
              children: [{ type: "inlineCode", value: "apps/web/src/components/ChatView.tsx" }],
            },
          ],
        },
      ],
    };

    linkifyInlineCodeFileReferences(tree, "/repo");

    expect(tree.children?.[0]?.children?.[0]).toEqual({
      type: "link",
      url: "apps/web/src/components/ChatView.tsx",
      children: [{ type: "inlineCode", value: "apps/web/src/components/ChatView.tsx" }],
    });
  });
});
