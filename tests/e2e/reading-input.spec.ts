import { test, expect } from "@playwright/test";
import { englishPdfFixture, pdfFixture } from "./pdf-fixture";
test("THE GREAT FUTURE·AI를 한글 자판으로 입력해도 원문에 맞추고 하단 줄은 표시하지 않는다", async ({
  page,
}) => {
  await page.goto("./local/");
  await page.getByLabel("학습 자료 파일 선택").setInputFiles({
    name: "영문표현.pdf",
    mimeType: "application/pdf",
    buffer: await englishPdfFixture(),
  });
  await expect(page.locator(".pdf-text-layer")).toContainText(
    "THE GREAT FUTURE AI",
  );
  const area = page.getByRole("textbox", { name: "필사 편집기" });
  await expect(page.locator(".transcription-tools")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "한글 → 영문", exact: true }),
  ).toHaveCount(0);
  await area.fill("캠페인 솓 ");
  await expect(area).toHaveValue("캠페인 THE ");
  await area.press("End");
  await page.keyboard.insertText("ㅎㄱㄷㅁㅅ ");
  await page.keyboard.insertText("려셔ㄱㄷ ");
  await expect(area).toHaveValue("캠페인 THE GREAT FUTURE ");
  await page.keyboard.insertText("먀가 ");
  await expect(area).toHaveValue("캠페인 THE GREAT FUTURE AI가 ");
  await area.fill("먀 ");
  await expect(area).toHaveValue("AI ");
  await area.press("ControlOrMeta+z");
  await expect(area).toHaveValue("먀 ");
  await area.press("ControlOrMeta+Shift+z");
  await expect(area).toHaveValue("AI ");
  await area.dispatchEvent("compositionstart");
  await area.fill("솓 ");
  await expect(area).toHaveValue("솓 ");
  await area.dispatchEvent("compositionend", { data: "솓" });
  await area.press("End");
  await page.keyboard.insertText(" ");
  await expect(area).toHaveValue("THE  ");
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(page.locator(".pdf-text-layer")).toContainText("English page 2");
  await area.fill("먀 ");
  await expect(area).toHaveValue("먀 ");
});

test("PDF를 클릭한 뒤 방향키로만 페이지를 넘기고 필사 커서·IME·조합키를 가로채지 않는다", async ({
  page,
}) => {
  await page.goto("./local/");
  await page.getByLabel("학습 자료 파일 선택").setInputFiles({
    name: "방향키.pdf",
    mimeType: "application/pdf",
    buffer: await pdfFixture(),
  });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  const area = page.getByRole("textbox", { name: "필사 편집기" }),
    pdf = page.getByLabel("PDF 스크롤 영역");
  const current = page.getByLabel("현재 PDF 페이지");
  await area.fill("필사는 방향키로 커서를 움직여요.");
  await area.press("End");
  const before = await area.evaluate(
    (e: HTMLTextAreaElement) => e.selectionStart,
  );
  await area.press("ArrowLeft");
  expect(
    await area.evaluate((e: HTMLTextAreaElement) => e.selectionStart),
  ).toBe(before - 1);
  await expect(current).toHaveValue("1");
  await pdf.click({ position: { x: 10, y: 10 } });
  await expect(pdf).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(current).toHaveValue("2");
  await expect(pdf).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(current).toHaveValue("1");
  await page.keyboard.press("ArrowLeft");
  await expect(current).toHaveValue("1");
  await pdf.dispatchEvent("keydown", { key: "ArrowRight", isComposing: true });
  await expect(current).toHaveValue("1");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(current).toHaveValue("1");
  await page.keyboard.press("Control+ArrowRight");
  await expect(current).toHaveValue("1");
  await current.selectOption("8");
  await pdf.focus();
  await page.keyboard.press("ArrowRight");
  await expect(current).toHaveValue("8");
  await page.keyboard.press("ArrowLeft");
  await expect(current).toHaveValue("7");
  await page.getByRole("button", { name: "전체화면", exact: true }).click();
  await pdf.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("전체화면 현재 페이지")).toHaveText("8 / 8");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByLabel("전체화면 현재 페이지")).toHaveText("7 / 8");
  await page
    .getByRole("button", { name: "전체화면 나가기", exact: true })
    .click();
  await current.selectOption("1");
  await expect(area).toHaveValue("필사는 방향키로 커서를 움직여요.");
});
