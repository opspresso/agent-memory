import { expect, test, type Page, type Locator } from "@playwright/test";

import { resetInstallationFixture } from "./installation-fixture";

async function createResource(page: Page, path: string, body: Record<string, unknown>) {
  const response = await page.request.post(path, { data: body, headers: { Origin: "http://127.0.0.1:3110" } });
  expect(response.ok()).toBe(true);
  return await response.json() as { id: string };
}

async function openGraph(page: Page, retry: number) {
  await resetInstallationFixture();
  await page.context().addCookies([{ name: "agent-memory-locale", value: "ko", domain: "127.0.0.1", path: "/" }]);
  await page.goto("/");
  await page.getByText("가입", { exact: true }).click();
  await page.getByLabel("이름").fill("Graph Motion Operator");
  await page.getByLabel("이메일").fill(`e2e+${process.env.E2E_RUN_ID}-${retry}@nalbam.com`);
  await page.getByLabel("비밀번호").fill("agent-memory-e2e-password");
  await page.getByRole("button", { name: "계정 만들기" }).click();
  await expect(page.getByRole("heading", { name: "통합 검색", exact: true })).toBeVisible();
  const scope = { kind: "organization" };
  const memory = await createResource(page, "/api/memories", { scope, kind: "fact", title: "Graph motion evidence", content: "Synthetic evidence for graph interaction tests.", source: { type: "user" } });
  const source = { memoryId: memory.id };
  const createNode = (name: string) => createResource(page, "/api/knowledge/nodes", { scope, source, kind: "service", canonicalName: name });
  const createEdge = (from: string, to: string) => createResource(page, "/api/knowledge/edges", { scope, source, sourceNodeId: from, targetNodeId: to, predicate: "uses" });
  const center = await createNode("Motion center");
  const branch = await createNode("Motion branch");
  const peer = await createNode("Motion peer");
  await createEdge(center.id, branch.id);
  await createEdge(center.id, peer.id);
  await page.goto("/?q=Motion%20center&kind=knowledge%2Fnodes");
  await page.getByRole("button", { name: /Motion center ·/ }).click();
  await page.getByRole("button", { name: "관계 보기", exact: true }).click();
  await expect(page.locator("[data-node-id]")).toHaveCount(3);
  return { center, branch, peer, createNode, createEdge };
}

async function sampleMotion(page: Page, frames = 60) {
  return page.evaluate((count) => new Promise<{ camera: string | null; nodes: { id: string; x: number; y: number }[] }[]>((resolve) => {
    const samples: { camera: string | null; nodes: { id: string; x: number; y: number }[] }[] = [];
    function sample() {
      samples.push({
        camera: document.querySelector("[data-graph-layer]")?.getAttribute("transform") ?? null,
        nodes: [...document.querySelectorAll<SVGGElement>("[data-node-id]")].filter((node) => node.transform.baseVal.numberOfItems > 0).map((node) => {
          const matrix = node.transform.baseVal.getItem(0).matrix;
          return { id: node.dataset.nodeId!, x: matrix.e, y: matrix.f };
        })
      });
      if (samples.length >= count) resolve(samples);
      else requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }), frames);
}

async function dragNode(page: Page, node: Locator, dx: number, dy: number) {
  await node.scrollIntoViewIfNeeded();
  const bounds = (await node.locator("circle").last().boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + dx, bounds.y + bounds.height / 2 + dy, { steps: 12 });
  await page.mouse.up();
}

test("clicking does not pin nodes; dragging, unpinning and expansion remain animated without moving the camera", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable PostgreSQL database");
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const graph = await openGraph(page, testInfo.retry);
  const branch = page.locator(`[data-node-id="${graph.branch.id}"]`);
  await branch.click();
  await expect(branch).toHaveAttribute("data-selected", "true");
  await expect(branch).not.toHaveAttribute("data-pinned", "true");
  const peer = page.locator(`[data-node-id="${graph.peer.id}"]`);
  await dragNode(page, branch, 70, 30);
  await expect(branch).toHaveAttribute("data-pinned", "true");
  const pinnedPosition = await branch.getAttribute("transform");
  const motion = await sampleMotion(page, 30);
  expect(new Set(motion.map((frame) => JSON.stringify(frame.nodes.find((node) => node.id === graph.peer.id)))).size).toBeGreaterThan(1);
  await expect(branch).toHaveAttribute("transform", pinnedPosition!);
  await branch.click({ button: "right" });
  await page.getByRole("menuitem", { name: "고정 해제", exact: true }).click();
  await expect(branch).not.toHaveAttribute("data-pinned", "true");
  await expect.poll(() => branch.getAttribute("transform")).not.toBe(pinnedPosition);
  await peer.focus();
  await page.keyboard.press("Enter");
  await expect(peer).not.toHaveAttribute("data-pinned", "true");

  const added = await graph.createNode("Motion expansion");
  await graph.createEdge(graph.branch.id, added.id);
  await branch.focus();
  await page.keyboard.press("Enter");
  const graphSvg = page.locator("svg").filter({ has: page.locator("[data-graph-layer]") });
  await graphSvg.hover();
  await page.mouse.wheel(0, -160);
  // Wait for the wheel gesture before sampling expansion; the camera should then stay unchanged.
  await page.waitForTimeout(250);
  const samples = sampleMotion(page, 90);
  await page.getByRole("button", { name: "확장", exact: true }).click();
  await expect(page.locator("[data-node-id]")).toHaveCount(4);
  const expanded = await samples;
  expect(new Set(expanded.map((frame) => frame.camera)).size).toBe(1);
  const positions = expanded.flatMap((frame) => frame.nodes.filter((node) => node.id === added.id));
  expect(new Set(positions.map((node) => `${node.x}:${node.y}`)).size).toBeGreaterThan(5);
  const steps = expanded.slice(1).flatMap((frame, index) => frame.nodes.flatMap((node) => {
    const previous = expanded[index]!.nodes.find((item) => item.id === node.id);
    return previous ? [Math.hypot(node.x - previous.x, node.y - previous.y)] : [];
  }));
  expect(Math.max(...steps)).toBeLessThan(25);
  await expect(branch).not.toHaveAttribute("data-pinned", "true");
  await expect.poll(async () => {
    const frames = await sampleMotion(page, 12);
    return JSON.stringify(frames[0]) === JSON.stringify(frames.at(-1));
  }, { timeout: 10_000 }).toBe(true);
  const repeated = sampleMotion(page, 60);
  await page.getByRole("button", { name: "확장", exact: true }).click();
  const repeatedFrames = await repeated;
  expect(new Set(repeatedFrames.map((frame) => JSON.stringify(frame))).size).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("graph-motion-expanded.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("reduced motion settles new nodes and preserves drag pins through fullscreen", async ({ page }, testInfo) => {
  test.skip(process.env.E2E_AUTHENTICATED !== "true", "requires a disposable PostgreSQL database");
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const graph = await openGraph(page, testInfo.retry);
  const branch = page.locator(`[data-node-id="${graph.branch.id}"]`);
  await dragNode(page, branch, 25, 20);
  await expect(branch).toHaveAttribute("data-pinned", "true");
  const position = await branch.getAttribute("transform");
  const added = await graph.createNode("Motion expansion");
  await graph.createEdge(graph.branch.id, added.id);
  await branch.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "확장", exact: true }).click();
  await expect(page.locator("[data-node-id]")).toHaveCount(4);
  const frames = await sampleMotion(page, 30);
  expect(new Set(frames.map((frame) => JSON.stringify(frame))).size).toBe(1);
  for (const node of frames[0]!.nodes) {
    for (const other of frames[0]!.nodes.filter((item) => item.id !== node.id)) {
      expect(Math.hypot(node.x - other.x, node.y - other.y)).toBeGreaterThan(30);
    }
  }
  await page.getByRole("button", { name: "전체 화면", exact: true }).click();
  await expect(branch).toHaveAttribute("transform", position!);
  await page.getByRole("button", { name: "전체 화면 종료", exact: true }).click();
  await expect(branch).toHaveAttribute("transform", position!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("graph-motion-mobile.png"), fullPage: true });
});
