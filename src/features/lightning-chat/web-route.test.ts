import { describe, expect, it } from "vitest";
import netlifyConfig from "../../../netlify.toml?raw";
import pages from "../../content/web-pages.json";

interface WebPage {
  path: string;
  title: string;
}

describe("Lightning Chat web deployment", () => {
  it("generates a first-class /chat page", () => {
    expect((pages as WebPage[]).find((page) => page.path === "/chat")).toMatchObject({
      path: "/chat",
      title: expect.stringContaining("Lightning Chat"),
    });
  });

  it("rewrites both chat URL forms and permits secure relay sockets", () => {
    expect(netlifyConfig).toContain('from = "/chat"');
    expect(netlifyConfig).toContain('from = "/chat/"');
    expect(netlifyConfig).toContain('to = "/chat/index.html"');
    expect(netlifyConfig).toMatch(
      /for = "\/chat"[\s\S]*?Content-Security-Policy = "[^"]*connect-src 'self' https: wss:/u,
    );
  });
});
