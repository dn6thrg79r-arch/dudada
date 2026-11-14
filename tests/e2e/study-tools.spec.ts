import { test, expect, type Page } from "@playwright/test";
import { pdfFixture } from "./pdf-fixture";
async function open(page: Page) {
  const buffer = await pdfFixture();
  await page.goto("./local/");
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "공부자료.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  return buffer;
}
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "필사 편집기" });
const saved = (page: Page) =>
  expect(page.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
test("원문 형광펜과 이름 있는 책갈피를 저장하고 확대·페이지 이동·재접속 후 복원·삭제한다", async ({
  page,
}, info) => {
  const buffer = await open(page);
  const canvas = page.getByRole("img", {
    name: "PDF 원본 1페이지",
    exact: true,
  });
  await canvas.evaluate((e) => e.setAttribute("data-kept", "yes"));
  const text = page
    .locator(".pdf-text-layer span")
    .filter({ hasText: "간호사 12 (ICU)." })
    .first();
  await expect(text).toBeVisible();
  const r = (await text.boundingBox())!;
  await page.mouse.move(r.x + 1, r.y + r.height / 2);
  await page.mouse.down();
  await page.mouse.move(r.x + r.width - 1, r.y + r.height / 2, { steps: 15 });
  await page.mouse.up();
  await page
    .getByRole("button", { name: "선택한 글에 형광펜", exact: true })
    .click();
  const marked = page.locator(".pdf-highlights span").first();
  await expect(marked).toBeVisible();
  await expect(canvas).toHaveAttribute("data-kept", "yes");
  const originalWidth = (await marked.boundingBox())!.width;
  await page
    .getByRole("button", { name: "현재 페이지 책갈피", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "현재 페이지 책갈피", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "책갈피·형광펜 관리", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "책갈피와 형광펜" });
  await dialog.getByLabel("1페이지 책갈피 이름").fill("다시 읽을 기사");
  await page.screenshot({ path: info.outputPath("reading-marks.png") });
  await expect(
    dialog.getByRole("button", { name: /1쪽 · 간호사/ }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByLabel("PDF 확대 비율").selectOption("200");
  await expect
    .poll(async () => (await marked.boundingBox())?.width || 0)
    .toBeGreaterThan(originalWidth * 1.5);
  const t = await text.evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y };
    }),
    h = (await marked.boundingBox())!;
  expect(Math.abs(t.y - h.y)).toBeLessThan(3);
  expect(Math.abs(t.x - h.x)).toBeLessThan(3);
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(page.locator(".pdf-highlights span")).toHaveCount(0);
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "책갈피·형광펜 관리", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "1페이지 책갈피로 이동", exact: true })
    .click();
  await expect(page.getByLabel("현재 PDF 페이지")).toHaveValue("1");
  await expect(marked).toBeAttached();
  await saved(page);
  await page.reload();
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "공부자료.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await expect(marked).toBeAttached();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("button", { name: "책갈피·형광펜 관리", exact: true })
    .click();
  await expect(dialog.getByLabel("1페이지 책갈피 이름")).toHaveValue(
    "다시 읽을 기사",
  );
  await dialog.getByRole("button", { name: /형광펜 삭제/ }).click();
  await dialog
    .getByRole("button", { name: "1페이지 책갈피 삭제", exact: true })
    .click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.locator(".pdf-highlights span")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "현재 페이지 책갈피", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("필사 이력은 주기적으로 보관되고 삭제 전 글을 복원·되돌리며 페이지별로 유지한다", async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  const original =
    "연구 결과와 환자 설명을 충분히 읽고 옮겨 적었습니다. 숫자 123과 ICU도 남깁니다.";
  await editor(page).fill(original);
  await editor(page).evaluate((e) => e.setAttribute("data-kept", "timer"));
  await page.clock.fastForward(61000);
  await expect(editor(page)).toHaveAttribute("data-kept", "timer");
  await page
    .getByRole("button", { name: "필사 이전 버전", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "1페이지 이전 버전" });
  await expect(dialog.getByLabel("이전 필사 미리보기")).toHaveValue(original);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await editor(page).fill("실수로 바꾼 글");
  await page
    .getByRole("button", { name: "필사 이전 버전", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "이 버전으로 복원", exact: true })
    .click();
  await expect(editor(page)).toHaveValue(original);
  await dialog
    .getByRole("group", { name: "보관된 버전" })
    .getByRole("button")
    .filter({ hasText: "복원 전 글" })
    .first()
    .click();
  await expect(dialog.getByLabel("이전 필사 미리보기")).toHaveValue(
    "실수로 바꾼 글",
  );
  await dialog
    .getByRole("button", { name: "이 버전으로 복원", exact: true })
    .click();
  await expect(editor(page)).toHaveValue("실수로 바꾼 글");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await editor(page).fill("2페이지는 다른 글");
  await saved(page);
  await page.reload();
  await expect(editor(page)).toHaveValue("2페이지는 다른 글");
  await page.getByRole("button", { name: "이전 페이지", exact: true }).click();
  await page
    .getByRole("button", { name: "필사 이전 버전", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "보관된 버전" }).getByRole("button"),
  ).not.toHaveCount(0);
});

test("PDF를 가려도 입력 DOM·커서·실행 취소를 유지하고 모바일·전체화면에서도 복귀한다", async ({
  page,
}) => {
  await open(page);
  await editor(page).fill("외워서 쓰는 글");
  await editor(page).press("End");
  await editor(page).pressSequentially("x");
  await editor(page).evaluate((e) => e.setAttribute("data-kept", "writing"));
  const before = (await editor(page).boundingBox())!.width;
  const caret = await editor(page).evaluate(
    (e: HTMLTextAreaElement) => e.selectionStart,
  );
  await page
    .getByRole("button", { name: "PDF 가리고 필사", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "PDF 뷰어", exact: true }),
  ).toBeHidden();
  expect((await editor(page).boundingBox())!.width).toBeGreaterThan(
    before * 1.5,
  );
  await expect(editor(page)).toHaveAttribute("data-kept", "writing");
  await expect(editor(page)).toBeFocused();
  expect(
    await editor(page).evaluate((e: HTMLTextAreaElement) => e.selectionStart),
  ).toBe(caret);
  await editor(page).press("ControlOrMeta+z");
  await expect(editor(page)).toHaveValue("외워서 쓰는 글");
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "PDF 뷰어", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "PDF 다시 보기", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "PDF 뷰어", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "전체화면", exact: true }).click();
  await page
    .getByRole("button", { name: "PDF 가리고 필사", exact: true })
    .click();
  await expect(editor(page)).toBeVisible();
  await page
    .getByRole("button", { name: "PDF 다시 보기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "전체화면 나가기", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "필사하기", exact: true }).click();
  await page
    .getByRole("button", { name: "PDF 가리고 필사", exact: true })
    .click();
  await expect(editor(page)).toBeVisible();
  await page.getByRole("button", { name: "PDF 보기", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "PDF 뷰어", exact: true }),
  ).toBeVisible();
});
