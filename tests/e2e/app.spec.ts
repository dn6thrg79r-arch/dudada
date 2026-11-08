import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { encryptedPdf } from "./encrypted-fixture";
import { PDFDocument, StandardFonts, PDFName, PDFDict } from "pdf-lib";
async function pdfFixture(blank = false, large = false) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Dudada def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n6 beginbfchar\n<41> <AC04>\n<42> <D638>\n<43> <C0AC>\n<58> <0049>\n<59> <0043>\n<5A> <0055>\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
  for (let i = 1; i <= 8; i++) {
    const page = doc.addPage([600, 800]);
    if (!blank) {
      page.drawText(`ABC 12 (XYZ).`, { x: 40, y: 700, font, size: 16 });
      page.drawText(`Page ${i}`, { x: 40, y: 650, font, size: 12 });
    }
  }
  await font.embed();
  const stream = doc.context.register(doc.context.flateStream(cmap));
  doc.context.lookup(font.ref, PDFDict).set(PDFName.of("ToUnicode"), stream);
  if (large)
    doc.context.register(doc.context.stream(new Uint8Array(101 * 1024 * 1024)));
  return Buffer.from(await doc.save());
}
async function pasteMaterial(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "텍스트 붙여넣기" }).click();
  await page.getByLabel("자료 제목", { exact: true }).fill("의학 암기노트");
  await page
    .getByLabel("학습할 글")
    .fill("간호사 12명 (ICU). 다음 문장입니다.");
  await page.getByRole("button", { name: "글 다듬기", exact: true }).click();
}
test("붙여넣기 → IME 조합 → 오타 수정 → 자동 이동 → 새로고침 복원 → 오답", async ({
  page,
}) => {
  await pasteMaterial(page);
  await page.getByRole("button", { name: "타자연습 시작" }).click();
  const input = page.getByRole("textbox", { name: "타자 입력" });
  await input.focus();
  await input.dispatchEvent("compositionstart");
  await input.fill("ㄱ");
  await input.dispatchEvent("compositionupdate", { data: "ㄱ" });
  await expect(
    page.getByText("한글을 조합하고 있어요… 조합이 끝난 뒤 비교합니다."),
  ).toBeVisible();
  await expect(page.locator(".stats")).toContainText("100%");
  await input.fill("간호사");
  await input.dispatchEvent("compositionend", { data: "간호사" });
  await expect(page.locator(".stats")).toContainText("100%");
  await input.fill("간호사 13명 (ICU).");
  await expect(page.locator(".incorrect")).toHaveCount(1);
  await page.getByLabel("자동 다음 문장").uncheck();
  await input.fill("간호사 12명 (ICU).");
  await expect(page.getByText("문장을 정확히 완성했어요.")).toBeVisible();
  await expect(page.locator(".stats")).toContainText("100%");
  await page.getByRole("button", { name: "다음 문장" }).click();
  await input.fill("다음");
  await expect(page.getByRole("status").last()).toHaveText(
    "이 브라우저에 저장됨",
  );
  await page.reload();
  await page.getByRole("button", { name: "이어서 공부하기" }).click();
  await expect(input).toHaveValue("다음");
  await input.fill("다음 문장입니다.");
  await expect(
    page.getByRole("heading", { name: "오늘도 두다다, 잘했어요." }),
  ).toBeVisible();
  await expect(page.locator(".wrong-list")).toContainText("간호사 12명 (ICU).");
  await page.getByRole("button", { name: "오답 다시 연습" }).click();
  await expect(input).toHaveValue("");
  await expect(page.locator(".target")).toHaveText("간호사 12명 (ICU).");
});
test("한글 파일명 8페이지 PDF → 3페이지 편집/부분 선택 → 저장 후 복원", async ({
  page,
}) => {
  await page.goto("/");
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") requests.push(r.url());
  });
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "병원소식지_8페이지.pdf",
    mimeType: "application/pdf",
    buffer: await pdfFixture(),
  });
  await expect(page.getByText(/총 8페이지/)).toBeVisible();
  await page.getByRole("button", { name: "글자 추출하기" }).click();
  await expect(
    page.getByRole("heading", { name: "내가 기억할 문장만 골라요." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "8페이지", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "3페이지", exact: true }).click();
  const text = page.getByRole("textbox", { name: "3페이지 텍스트" });
  await expect(text).toHaveValue(/간호사 12 \(ICU\)\./);
  await expect(page.getByLabel("PDF 원본 3페이지")).toBeVisible();
  await text.fill("연구 결과는 12%입니다. ICU (3명)입니다!");
  await text.focus();
  await text.press("Home");
  for (let i = 0; i < 15; i++) await text.press("Shift+ArrowRight");
  await expect(
    page.getByRole("button", { name: "선택한 글만 새 자료로 만들기" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "선택한 글만 새 자료로 만들기" })
    .click();
  await expect(page.getByLabel("자료 제목", { exact: true })).toHaveValue(
    /선택한 글/,
  );
  await page
    .getByRole("button", { name: "학습자료 저장", exact: true })
    .click();
  await expect(page.getByRole("status").last()).toHaveText(/저장됨/);
  await page.reload();
  await expect(page.locator(".material")).toHaveCount(2);
  await page.getByRole("button", { name: "이어서 공부하기" }).first().click();
  await expect(page.locator(".page-heading")).toContainText("원문 3페이지");
  const target = await page.locator(".target").innerText();
  await page.getByRole("textbox", { name: "타자 입력" }).fill(target);
  await expect(
    page.getByRole("heading", { name: "오늘도 두다다, 잘했어요." }),
  ).toBeVisible();
  expect(requests).toEqual([]);
});
test("텍스트 없는 PDF, 손상 파일, 암호 필요 파일을 안내한다", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "스캔.pdf",
    mimeType: "application/pdf",
    buffer: await pdfFixture(true),
  });
  await page.getByRole("button", { name: "글자 추출하기" }).click();
  await expect(page.locator("main [role=alert]")).toContainText(
    "글자 인식(OCR)이 필요합니다",
  );
  await expect(
    page.getByRole("button", { name: /한국어·영어 OCR/ }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "내 공부방", exact: true }).click();
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "손상.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("broken pdf"),
  });
  await expect(page.locator("main [role=alert]")).toContainText("손상");
});
test("TXT 불러오기와 모바일 화면의 가로 넘침 방지", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("TXT 파일 선택").setInputFiles({
    name: "암기노트.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("환자 3명.\n의학용어 ICU."),
  });
  await expect(
    page.getByRole("textbox", { name: "1페이지 텍스트" }),
  ).toHaveValue("환자 3명.\n의학용어 ICU.");
  await page.getByRole("button", { name: "타자연습 시작" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "어두운 화면" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("암호가 걸린 PDF는 암호 입력 후 다시 열린다", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "암호.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(encryptedPdf, "base64"),
  });
  await expect(page.locator("main [role=alert]")).toContainText("암호");
  await page.getByLabel("PDF 암호 (필요한 경우)").fill("study123");
  await page.getByRole("button", { name: "파일 다시 열기" }).click();
  await expect(page.getByText(/총 1페이지/)).toBeVisible();
  await page.getByRole("button", { name: "글자 추출하기" }).click();
  await expect(
    page.getByRole("textbox", { name: "1페이지 텍스트" }),
  ).toHaveValue(/ICU 12 patients/);
});
test("100MB 이상 PDF에서 진행률과 페이지 범위 추출", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/");
  const path = testInfo.outputPath("큰소식지.pdf");
  await writeFile(path, await pdfFixture(false, true));
  await page.getByLabel("PDF 파일 선택").setInputFiles(path);
  await expect(
    page.getByText("100MB 이상 파일입니다.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/총 8페이지/)).toBeVisible();
  await page.getByLabel("추출할 페이지", { exact: true }).fill("3");
  await page.getByRole("button", { name: "글자 추출하기" }).click();
  await expect(
    page.getByRole("textbox", { name: "3페이지 텍스트" }),
  ).toHaveValue(/간호사/);
  await expect(
    page.getByRole("button", { name: "8페이지", exact: true }),
  ).toHaveCount(0);
});

test("iPad 가로·세로 배치와 일시정지", async ({ page }, testInfo) => {
  await pasteMaterial(page);
  await page.getByRole("button", { name: "타자연습 시작" }).click();
  for (const size of [
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "잠깐 멈춤" }).click();
  await expect(page.getByRole("textbox", { name: "타자 입력" })).toBeDisabled();
  await page.getByRole("button", { name: "계속하기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "타자 입력" })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("mobile-practice.png"),
    fullPage: true,
  });
});
