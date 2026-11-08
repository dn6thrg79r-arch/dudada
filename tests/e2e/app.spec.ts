import { test, expect, type Page } from "@playwright/test";
import { writeFile, readFile } from "node:fs/promises";
import { pdfFixture } from "./pdf-fixture";
import { encryptedPdf } from "./encrypted-fixture";
async function openPdf(page: Page) {
  await page.goto("./");
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "병원소식_8페이지.pdf",
    mimeType: "application/pdf",
    buffer: await pdfFixture(),
  });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
}
const editor = (page: Page) =>
  page.getByRole("textbox", { name: "필사 편집기" });
async function saved(page: Page) {
  await expect(page.locator(".save-state")).toContainText("자동 저장됨");
}
test("PDF 원본 + 빈 편집기 → 자유 입력 → 확대·스크롤·페이지별 저장 → 복원·재연결·내보내기", async ({
  page,
}) => {
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  await openPdf(page);
  await expect(editor(page)).toHaveValue("");
  const text =
    "연구 기사 정독  ICU (12명).\n\n내 생각과 원문의 문장을 자유롭게 씁니다.";
  await editor(page).fill(text);
  await saved(page);
  const node = await editor(page).elementHandle();
  await page.getByLabel("PDF 확대 비율").selectOption("200");
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await editor(page).focus();
  await editor(page).evaluate((el) => {
    el.scrollTop = 14;
  });
  await page.getByLabel("PDF 스크롤 영역").evaluate((el) => {
    el.scrollTop = 400;
    el.scrollLeft = 80;
  });
  await expect(editor(page)).toBeFocused();
  await expect(editor(page)).toHaveValue(text);
  expect(
    await node?.evaluate((el) => el === document.querySelector(".manuscript")),
  ).toBe(true);
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(editor(page)).toHaveValue("");
  await editor(page).fill("2페이지의 자유로운 기록");
  await page.getByRole("button", { name: "이전 페이지", exact: true }).click();
  await expect(editor(page)).toHaveValue(text);
  await saved(page);
  await page.reload();
  await expect(editor(page)).toHaveValue(text);
  await expect(
    page.getByRole("button", { name: "원본 PDF 다시 연결" }),
  ).toBeVisible();
  await expect(page.getByLabel("PDF 확대 비율")).toHaveValue("200");
  await page.getByRole("button", { name: "원본 PDF 다시 연결" }).click();
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "병원소식_8페이지.pdf",
    mimeType: "application/pdf",
    buffer: await pdfFixture(),
  });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await expect(editor(page)).toHaveValue(text);
  await page.locator(".export-menu summary").click();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "모든 페이지 TXT", exact: true })
    .click();
  const f = await download;
  const output = await readFile((await f.path())!, "utf8");
  expect(output).toContain(text);
  expect(output).toContain("2페이지의 자유로운 기록");
  expect(posts).toEqual([]);
});
test("페이지 연결 해제·분할 드래그·글씨 크기를 저장한다", async ({ page }) => {
  await openPdf(page);
  await editor(page).fill("참고하며 쓰는 글");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("PDF 페이지에 맞춰 필사 전환").uncheck();
  await page.getByLabel("편집기 글씨 크기").selectOption("26");
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await expect(editor(page)).toHaveValue("참고하며 쓰는 글");
  await expect(page.getByLabel("필사 페이지", { exact: true })).toHaveValue(
    "1",
  );
  const handle = page.getByRole("separator", { name: "좌우 영역 크기 조절" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 4, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + 100);
  await page.mouse.up();
  expect(+(await handle.getAttribute("aria-valuenow"))!).toBeLessThan(55);
  await saved(page);
  await page.reload();
  await expect(editor(page)).toHaveValue("참고하며 쓰는 글");
  await expect(editor(page)).toHaveCSS("font-size", "26px");
  await expect(page.getByLabel("현재 PDF 페이지")).toHaveValue("2");
  await expect(page.getByLabel("필사 페이지", { exact: true })).toHaveValue(
    "1",
  );
});
test("한글 조합, 네이티브 실행 취소·다시 실행, 편집기 DOM과 커서 유지", async ({
  page,
}) => {
  await openPdf(page);
  const el = editor(page);
  await expect(el).toHaveAttribute("spellcheck", "false");
  await el.focus();
  await el.dispatchEvent("compositionstart");
  await el.fill("ㅎ");
  await el.dispatchEvent("compositionupdate", { data: "ㅎ" });
  await el.fill("한글 필사");
  await el.dispatchEvent("compositionend", { data: "한글 필사" });
  await expect(el).toHaveValue("한글 필사");
  await saved(page);
  await el.press("End");
  await page.keyboard.insertText(" 자유");
  await el.press("ControlOrMeta+z");
  await expect(el).toHaveValue("한글 필사");
  await el.press("ControlOrMeta+Shift+z");
  await expect(el).toHaveValue("한글 필사 자유");
  const node = await el.elementHandle();
  await page.getByRole("button", { name: "PDF 확대", exact: true }).click();
  expect(
    await node?.evaluate((n) => n === document.querySelector(".manuscript")),
  ).toBe(true);
  await expect(el).toHaveValue("한글 필사 자유");
});
test("저장 실패를 표시하고 재시도로 복구한다", async ({ page }) => {
  await openPdf(page);
  await saved(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restoreStore: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function () {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await editor(page).fill("저장에 실패해도 화면에 남는 글");
  await expect(
    page.getByRole("alert").filter({ hasText: "자동 저장에 실패" }),
  ).toBeVisible();
  await expect(page.locator(".save-state")).toContainText("저장 실패");
  await expect(editor(page)).toHaveValue("저장에 실패해도 화면에 남는 글");
  await page.evaluate(() => {
    (window as unknown as { restoreStore: () => void }).restoreStore();
  });
  await page.getByRole("button", { name: "저장 재시도" }).click();
  await saved(page);
  await page.reload();
  await expect(editor(page)).toHaveValue("저장에 실패해도 화면에 남는 글");
});
test("스캔·암호·손상 PDF, 100MB 이상의 선택 페이지 렌더링", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  await page.goto("./");
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "스캔.pdf",
    mimeType: "application/pdf",
    buffer: await pdfFixture(true),
  });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await editor(page).fill("이미지 PDF도 자유롭게 필사");
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "암호.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(encryptedPdf, "base64"),
  });
  await expect(
    page
      .locator("main [role=alert], .notice[role=alert]")
      .filter({ hasText: "암호" }),
  ).toBeVisible();
  await page.getByLabel("PDF 암호", { exact: true }).fill("study123");
  await page.getByRole("button", { name: "다시 열기", exact: true }).click();
  await expect(page.locator(".document-name")).toContainText("암호.pdf");
  await expect(page.getByLabel("PDF 파일 선택")).toBeEnabled();
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "손상.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("broken"),
  });
  await expect(
    page.locator(".notice[role=alert]").filter({ hasText: "손상" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  const path = info.outputPath("큰신문.pdf");
  await writeFile(path, await pdfFixture(false, true));
  await page.getByLabel("PDF 파일 선택").setInputFiles(path);
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await page.getByLabel("현재 PDF 페이지").selectOption("8");
  await expect(
    page.getByRole("img", { name: "PDF 원본 8페이지", exact: true }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(1);
  await editor(page).fill("큰 PDF도 필사");
  await saved(page);
});
test("TXT·Markdown 가져오기와 내보내기, 스마트폰 탭·iPad 배치", async ({
  page,
}, info) => {
  await openPdf(page);
  await page.getByLabel("필사 파일 불러오기", { exact: true }).setInputFiles({
    name: "기존필사.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("## 나의 필사\n\n한국어와 ICU 12명."),
  });
  await expect(editor(page)).toHaveValue("## 나의 필사\n\n한국어와 ICU 12명.");
  for (const size of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(size);
    await expect(editor(page)).toBeVisible();
    await expect(page.getByLabel("PDF 스크롤 영역")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("PDF 스크롤 영역")).toBeVisible();
  await page.getByRole("button", { name: "필사하기", exact: true }).click();
  await expect(editor(page)).toBeVisible();
  await expect(page.getByLabel("PDF 스크롤 영역")).toBeHidden();
  await page.screenshot({
    path: info.outputPath("mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: info.outputPath("desktop.png"),
    fullPage: true,
  });
});

test("이전 버전 자료를 지우지 않고 실제 입력 글을 필사로 복원한다", async ({
  page,
}) => {
  await page.goto("./__legacy_seed__");
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("dudada-study", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("materials", { keyPath: "id" });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("materials", "readwrite");
          tx.objectStore("materials").put({
            id: "old",
            title: "이전 공부",
            source: "소식.pdf",
            pageCount: 8,
            mode: "study",
            updated: "2026-11-08T00:00:00Z",
            pages: [{ number: 1, text: "추출 후 편집했던 원문" }],
            records: {
              "study:1:0": { input: "내가 입력했던 필사" },
              "exact:1:0": { input: "다른 모드" },
            },
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
  );
  await page.goto("./");
  await expect(editor(page)).toHaveValue("내가 입력했던 필사");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이전 버전 편집 글 내려받기" }),
  ).toBeVisible();
  const original = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const r = indexedDB.open("dudada-study", 2);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("materials");
          const read = tx.objectStore("materials").get("old");
          read.onsuccess = () => resolve(read.result.pages[0].text);
          tx.oncomplete = () => db.close();
        };
      }),
  );
  expect(original).toBe("추출 후 편집했던 원문");
});

test("한글을 연속 입력해도 상단 버튼과 도구줄이 반짝이거나 움직이지 않는다", async ({
  page,
}) => {
  await openPdf(page);
  await saved(page);
  const area = editor(page);
  await area.focus();
  const header = page.locator(".app-header"),
    toolbar = page.locator(".document-toolbar");
  const headerImage = await header.screenshot(),
    toolbarImage = await toolbar.screenshot();
  const headerBox = await header.boundingBox(),
    toolbarBox = await toolbar.boundingBox();
  const canvas = await page.locator("canvas").elementHandle();
  const input = await area.elementHandle();
  // Delayed storage makes the in-flight state observable; the indicator must remain neutral and stable.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      const started = performance.now();
      while (performance.now() - started < 25) {}
      return original.apply(this, args);
    };
  });
  for (const value of ["ㅎ", "한", "한ㄱ", "한글", "한글 ㅍ", "한글 필사"]) {
    await area.dispatchEvent("compositionstart");
    await area.fill(value);
    await area.dispatchEvent("compositionupdate", { data: value.at(-1) });
    await expect(
      page.getByRole("button", { name: "PDF 불러오기", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "다음 페이지", exact: true }),
    ).toBeEnabled();
    expect(await header.screenshot()).toEqual(headerImage);
    expect(await toolbar.screenshot()).toEqual(toolbarImage);
    await area.dispatchEvent("compositionend", { data: value.at(-1) });
  }
  await saved(page);
  expect(await header.boundingBox()).toEqual(headerBox);
  expect(await toolbar.boundingBox()).toEqual(toolbarBox);
  expect(
    await input?.evaluate((el) => el === document.querySelector(".manuscript")),
  ).toBe(true);
  expect(
    await canvas?.evaluate((el) => el === document.querySelector("canvas")),
  ).toBe(true);
  await expect(area).toBeFocused();
  await page.reload();
  await expect(editor(page)).toHaveValue("한글 필사");
});
