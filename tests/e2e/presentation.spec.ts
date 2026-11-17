import { test, expect } from "@playwright/test";
import { pptxFixture } from "./pptx-fixture";
test("서버 없이 PPTX의 한국어·표·이미지를 읽고 슬라이드별 필사·방향키·저장을 지원한다", async ({
  page,
}, info) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    if (!new URL(r.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      outside.push(r.url());
  });
  await page.goto("./local/");
  const buffer = await pptxFixture(true);
  await page.getByLabel("학습 자료 파일 선택").setInputFiles({
    name: "한국어_발표자료.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  });
  await expect(page.getByLabel("현재 슬라이드")).toHaveValue("1");
  const iframe = page.frameLocator(
    'iframe[title="프레젠테이션 원본 1슬라이드"]',
  );
  await expect(
    iframe.getByText("두다다 공부방 · 첫 슬라이드", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(iframe.getByText("한국어 표", { exact: true })).toBeVisible();
  await expect(iframe.locator("img").first()).toBeVisible();
  await iframe.getByText("한국어 표", { exact: true }).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.getByRole("button", { name: "선택한 글에 형광펜" }).click();
  await expect(page.locator(".pdf-highlights span")).toHaveCount(1);
  await expect(iframe.getByText(/<img src=/)).toBeVisible();
  expect(
    await page.evaluate(() => document.body.dataset.pptxAttack),
  ).toBeUndefined();
  expect(outside).toEqual([]);
  await page.screenshot({ path: info.outputPath("presentation-local.png") });
  const editor = page.getByRole("textbox", { name: "필사 편집기" });
  await editor.fill("첫 슬라이드에서 자유롭게 필사합니다.");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(page.getByLabel("현재 슬라이드")).toHaveValue("2");
  await expect(
    page
      .frameLocator('iframe[title="프레젠테이션 원본 2슬라이드"]')
      .getByText("AI와 THE GREAT FUTURE", { exact: true }),
  ).toBeVisible();
  await editor.fill("먀가 ");
  await expect(editor).toHaveValue("AI가 ");
  await page
    .frameLocator('iframe[title="프레젠테이션 원본 2슬라이드"]')
    .getByText("AI와 THE GREAT FUTURE", { exact: true })
    .click();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("현재 슬라이드")).toHaveValue("1");
  await expect(editor).toHaveValue("첫 슬라이드에서 자유롭게 필사합니다.");
  await expect(page.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  await page.reload();
  await expect(editor).toHaveValue("첫 슬라이드에서 자유롭게 필사합니다.");
  await page.getByLabel("학습 자료 파일 선택").setInputFiles({
    name: "한국어_발표자료.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  });
  await expect(
    page
      .frameLocator('iframe[title="프레젠테이션 원본 1슬라이드"]')
      .getByText("두다다 공부방 · 첫 슬라이드", { exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue("첫 슬라이드에서 자유롭게 필사합니다.");
  expect(outside).toEqual([]);
});

test("잘못된 PPTX와 예전 PPT 파일은 원인을 안내한다", async ({ page }) => {
  await page.goto("./local/");
  const picker = page.getByLabel("학습 자료 파일 선택");
  await picker.setInputFiles({
    name: "손상.pptx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("broken zip"),
  });
  await expect(page.locator(".notice.error")).toContainText(
    "손상되었거나 암호",
  );
  await expect(page.getByLabel("PDF 암호")).toHaveCount(0);
  await picker.setInputFiles({
    name: "옛발표.ppt",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("old ppt"),
  });
  await expect(page.locator(".notice.error")).toContainText("PPTX 또는 PDF");
});

test("PPTX의 실제 슬라이드 순서를 따르고 확대 중 편집기 DOM을 유지한다", async ({
  page,
}) => {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await pptxFixture());
  const xml = await zip.file("ppt/presentation.xml")!.async("string");
  zip.file(
    "ppt/presentation.xml",
    xml.replace(/(<p:sldId[^>]*\/>)(<p:sldId[^>]*\/>)/, "$2$1"),
  );
  await page.goto("./local/");
  await page.getByLabel("학습 자료 파일 선택").setInputFiles({
    name: "순서변경.pptx",
    mimeType: "application/octet-stream",
    buffer: await zip.generateAsync({ type: "nodebuffer" }),
  });
  await expect(
    page
      .frameLocator("iframe")
      .getByText("AI와 THE GREAT FUTURE", { exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", { name: "필사 편집기" });
  await editor.fill("확대 중에도 글을 유지합니다.");
  await editor.evaluate((el) => {
    el.dataset.identity = "stable";
  });
  await page.getByLabel("슬라이드 확대 비율").selectOption("200");
  await expect(editor).toHaveAttribute("data-identity", "stable");
  await expect(editor).toHaveValue("확대 중에도 글을 유지합니다.");
  await expect(
    page
      .frameLocator("iframe")
      .getByText("AI와 THE GREAT FUTURE", { exact: true }),
  ).toBeVisible();
});

test("PPTX 사진은 STORE·DEFLATE 원래 압축 방식을 그대로 재사용한다", async ({
  page,
}) => {
  const { default: Zip } = await import("jszip");
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (
        event.data?.type !== "load" ||
        !(event.data.bytes instanceof ArrayBuffer)
      )
        return;
      const v = new DataView(event.data.bytes),
        methods: number[] = [];
      for (let at = 0; at < v.byteLength - 46; at++) {
        if (v.getUint32(at, true) !== 0x02014b50) continue;
        const n = v.getUint16(at + 28, true),
          name = new TextDecoder().decode(
            new Uint8Array(event.data.bytes, at + 46, n),
          );
        if (name.startsWith("ppt/media/") && !name.endsWith("/"))
          methods.push(v.getUint16(at + 10, true));
      }
      (window as unknown as { testMediaMethods: number[] }).testMediaMethods =
        methods;
    });
  });
  await page.goto("./local/");
  for (const method of ["STORE", "DEFLATE"] as const) {
    const zip = await Zip.loadAsync(await pptxFixture());
    for (const name of Object.keys(zip.files).filter(
      (n) => n.startsWith("ppt/media/") && !n.endsWith("/"),
    ))
      zip.file(name, await zip.file(name)!.async("uint8array"), {
        compression: method,
      });
    await page.getByLabel("학습 자료 파일 선택").setInputFiles({
      name: `사진_${method}.pptx`,
      mimeType: "application/octet-stream",
      buffer: await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
      }),
    });
    const frame = page.frameLocator(
      'iframe[title="프레젠테이션 원본 1슬라이드"]',
    );
    await expect(
      frame.getByText("두다다 공부방 · 첫 슬라이드", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        frame
          .locator("body")
          .evaluate(() =>
            Array.from(
              new Set(
                (window as unknown as { testMediaMethods?: number[] })
                  .testMediaMethods || [],
              ),
            ),
          ),
      )
      .toEqual([method === "STORE" ? 0 : 8]);
    await expect(frame.locator("img").first()).toBeVisible();
  }
});
