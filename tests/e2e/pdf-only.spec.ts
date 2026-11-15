import { test, expect } from "@playwright/test";
import { pdfFixture } from "./pdf-fixture";
test("필사 가리기는 PDF를 넓히고 복귀 시 글·커서·스크롤·실행 취소를 보존한다", async ({
  page,
}, info) => {
  await page.goto("./local/");
  await page
    .getByLabel("PDF 파일 선택")
    .setInputFiles({
      name: "집중읽기.pdf",
      mimeType: "application/pdf",
      buffer: await pdfFixture(),
    });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", { name: "필사 편집기" });
  const pdf = page.getByRole("region", { name: "PDF 뷰어", exact: true });
  const original = Array.from(
    { length: 80 },
    (_, i) => `${i + 1}번째 문단 · 원문을 읽고 쓰는 글`,
  ).join("\n");
  await editor.fill(original);
  await editor.press("ControlOrMeta+End");
  await editor.pressSequentially("x");
  await editor.evaluate((e: HTMLTextAreaElement) => {
    e.setAttribute("data-kept", "yes");
    e.scrollTop = 300;
  });
  const cursor = await editor.evaluate((e: HTMLTextAreaElement) => ({
    start: e.selectionStart,
    end: e.selectionEnd,
    top: e.scrollTop,
  }));
  const before = (await pdf.boundingBox())!.width;
  await page.getByRole("button", { name: "필사 가리기", exact: true }).click();
  await expect(editor).toBeHidden();
  expect((await pdf.boundingBox())!.width).toBeGreaterThan(before * 1.5);
  await expect(
    page.getByRole("separator", { name: "좌우 영역 크기 조절" }),
  ).toBeHidden();
  await expect(page.locator(".manuscript")).toHaveAttribute("data-kept", "yes");
  await expect(
    page.getByRole("button", { name: "필사 다시 보기", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("pdf-only-desktop.png") });
  await page
    .getByRole("button", { name: "필사 다시 보기", exact: true })
    .click();
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((e: HTMLTextAreaElement) => ({
      start: e.selectionStart,
      end: e.selectionEnd,
      top: e.scrollTop,
    })),
  ).toEqual(cursor);
  await expect(editor).toHaveValue(original + "x");
  await editor.press("ControlOrMeta+z");
  await expect(editor).toHaveValue(original);
  // Switching directly between both one-pane views never hides both panes.
  await page
    .getByRole("button", { name: "PDF 가리고 필사", exact: true })
    .click();
  await expect(pdf).toBeHidden();
  await page.getByRole("button", { name: "필사 가리기", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(pdf).toBeVisible();
  await expect(page.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  await page.reload();
  await expect(editor).toBeHidden();
  await expect(
    page.getByRole("button", { name: "필사 다시 보기", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "필사 다시 보기", exact: true })
    .click();
  await expect(editor).toHaveValue(original);
  await page.getByRole("button", { name: "전체화면", exact: true }).click();
  await page.getByRole("button", { name: "필사 가리기", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(pdf).toBeVisible();
  await page
    .getByRole("button", { name: "필사 다시 보기", exact: true })
    .click();
  await expect(editor).toBeVisible();
  await page
    .getByRole("button", { name: "전체화면 나가기", exact: true })
    .click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "필사하기", exact: true }).click();
    await page
      .getByRole("button", { name: "필사 가리기", exact: true })
      .click();
    await expect(pdf).toBeVisible();
    await expect(editor).toBeHidden();
    const toolbar = (await page.locator(".document-toolbar").boundingBox())!;
    expect(toolbar.height).toBeLessThanOrEqual(90);
    const last = (await page
      .getByRole("button", { name: "필사 이전 버전", exact: true })
      .boundingBox())!;
    const zoom = (await page.getByLabel("PDF 확대 비율").boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(zoom.x);
    await page.getByRole("button", { name: "필사하기", exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(
      page.getByRole("button", { name: "필사 가리기", exact: true }),
    ).toBeVisible();
  }
});
