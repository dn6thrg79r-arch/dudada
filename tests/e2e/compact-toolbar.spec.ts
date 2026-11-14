import { test, expect } from "@playwright/test";
import { pdfFixture } from "./pdf-fixture";
test("설명줄 없이 페이지 옆 아이콘 한 줄을 유지하고 휴대폰에서도 두 줄 안에 맞춘다", async ({
  page,
}, info) => {
  await page.goto("./local/");
  await page
    .getByLabel("PDF 파일 선택")
    .setInputFiles({
      name: "긴_병원소식지_파일이름_8페이지.pdf",
      mimeType: "application/pdf",
      buffer: await pdfFixture(),
    });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".pane-heading,.pdf-mark-tools,.editor-foot"),
  ).toHaveCount(0);
  await expect(page.getByText("원본 읽기", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "표시 목록", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("필사 파일 불러오기", { exact: true }),
  ).toHaveCount(0);
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(size);
    const toolbar = (await page.locator(".document-toolbar").boundingBox())!;
    expect(toolbar.height).toBeLessThanOrEqual(65);
    const current = (await page.getByLabel("현재 PDF 페이지").boundingBox())!;
    for (const name of [
      "현재 페이지 책갈피",
      "PDF 가리고 필사",
      "필사 이전 버전",
    ]) {
      const icon = page.getByRole("button", { name, exact: true });
      const r = (await icon.boundingBox())!;
      expect(
        Math.abs(r.y + r.height / 2 - (current.y + current.height / 2)),
      ).toBeLessThan(4);
      expect(await icon.textContent()).toBe("");
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("compact-tablet.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (await page.locator(".document-toolbar").boundingBox())!.height,
  ).toBeLessThanOrEqual(90);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("PDF 확대 비율").selectOption("150");
  await page.screenshot({ path: info.outputPath("compact-mobile.png") });
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(
    page.getByLabel("필사 파일 불러오기", { exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("button", { name: "책갈피·형광펜 관리", exact: true }),
  ).toBeVisible();
});
