import { resolveMarkdownFileLinkTarget } from "./markdown-links";

interface MarkdownAstNode {
  type?: string;
  value?: unknown;
  url?: string;
  children?: MarkdownAstNode[];
}

function transformChildren(node: MarkdownAstNode, cwd: string | undefined): void {
  const children = node.children;
  if (!Array.isArray(children) || children.length === 0) {
    return;
  }

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (!child || typeof child !== "object") {
      continue;
    }

    if (child.type === "link") {
      continue;
    }

    if (child.type === "inlineCode" && typeof child.value === "string") {
      const href = child.value.trim();
      if (resolveMarkdownFileLinkTarget(href, cwd)) {
        children[index] = {
          type: "link",
          url: href,
          children: [child],
        };
        continue;
      }
    }

    transformChildren(child, cwd);
  }
}

export function linkifyInlineCodeFileReferences(
  tree: MarkdownAstNode,
  cwd: string | undefined,
): void {
  transformChildren(tree, cwd);
}

export function remarkLinkifyInlineCodeFileReferences(cwd: string | undefined) {
  return (tree: MarkdownAstNode) => {
    linkifyInlineCodeFileReferences(tree, cwd);
  };
}
