import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ChatAttachment } from "@xbetools/contracts";

import { materializeImageAttachments } from "./attachmentMaterializer.ts";

const TEST_IMAGE_BYTES = Buffer.from("fake-png-bytes");

describe("materializeImageAttachments", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = join(tmpdir(), `xbe-test-attachments-${randomUUID()}`);
    mkdirSync(join(stateDir, "attachments"), { recursive: true });
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  function persistAttachment(id: string, extension: string, bytes: Buffer = TEST_IMAGE_BYTES) {
    const filePath = join(stateDir, "attachments", `${id}${extension}`);
    writeFileSync(filePath, bytes);
    return filePath;
  }

  it("materializes a persisted image attachment to base64", () => {
    const attachmentId = `test-thread-${randomUUID()}`;
    persistAttachment(attachmentId, ".png");

    const attachment: ChatAttachment = {
      type: "image",
      id: attachmentId as any,
      name: "screenshot.png" as any,
      mimeType: "image/png" as any,
      sizeBytes: TEST_IMAGE_BYTES.byteLength as any,
    };

    const result = materializeImageAttachments({
      stateDir,
      attachments: [attachment],
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(attachmentId);
    expect(result[0]!.name).toBe("screenshot.png");
    expect(result[0]!.mimeType).toBe("image/png");
    expect(result[0]!.base64).toBe(TEST_IMAGE_BYTES.toString("base64"));
  });

  it("materializes multiple image attachments", () => {
    const id1 = `test-thread-${randomUUID()}`;
    const id2 = `test-thread-${randomUUID()}`;
    persistAttachment(id1, ".png");
    persistAttachment(id2, ".jpg", Buffer.from("jpeg-data"));

    const attachments: ChatAttachment[] = [
      {
        type: "image",
        id: id1 as any,
        name: "first.png" as any,
        mimeType: "image/png" as any,
        sizeBytes: TEST_IMAGE_BYTES.byteLength as any,
      },
      {
        type: "image",
        id: id2 as any,
        name: "second.jpg" as any,
        mimeType: "image/jpeg" as any,
        sizeBytes: 9 as any,
      },
    ];

    const result = materializeImageAttachments({ stateDir, attachments });
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe("first.png");
    expect(result[1]!.name).toBe("second.jpg");
  });

  it("skips attachments that cannot be resolved", () => {
    const result = materializeImageAttachments({
      stateDir,
      attachments: [
        {
          type: "image",
          id: "nonexistent-id" as any,
          name: "missing.png" as any,
          mimeType: "image/png" as any,
          sizeBytes: 100 as any,
        },
      ],
    });

    expect(result).toHaveLength(0);
  });

  it("skips empty files", () => {
    const id = `test-thread-${randomUUID()}`;
    persistAttachment(id, ".png", Buffer.alloc(0));

    const result = materializeImageAttachments({
      stateDir,
      attachments: [
        {
          type: "image",
          id: id as any,
          name: "empty.png" as any,
          mimeType: "image/png" as any,
          sizeBytes: 0 as any,
        },
      ],
    });

    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty attachments list", () => {
    const result = materializeImageAttachments({
      stateDir,
      attachments: [],
    });

    expect(result).toHaveLength(0);
  });
});
