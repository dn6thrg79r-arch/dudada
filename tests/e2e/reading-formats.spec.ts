import { test, expect } from "@playwright/test";
import { officeFixture, hwpFixture, photo } from "./reading-fixture";
for (const kind of ["docx", "hwpx", "hwp", "txt", "md", "image"] as const) {
  test(`${kind}: 서버 없이 원문을 보며 필사하고 확대·재연결·TXT 내보내기를 지원한다`, async ({
    page,
  }, info) => {
    const outside: string[] = [];
    page.on("request", (r) => {
      if (
        !["127.0.0.1", "localhost"].includes(new URL(r.url()).hostname) &&
        !r.url().startsWith("blob:")
      )
        outside.push(r.url());
    });
    await page.goto("./local/");
    const name = kind === "image" ? "교재사진.png" : `한국어_학습자료.${kind}`;
    const buffer =
      kind === "docx" || kind === "hwpx"
        ? await officeFixture(kind, true)
        : kind === "hwp"
          ? hwpFixture()
          : kind === "image"
            ? photo
            : Buffer.from(
                kind === "md"
                  ? '# 한국어 Markdown 암기노트\n\n**AI** 연구 결과 123명\n\n|자료|결과|\n|---|---|\n|한국어 표|123명|\n\n<img src="https://reading-leak.invalid/x" onerror="document.body.dataset.attack=1">'
                  : "한국어 TXT 암기노트\n\nAI 연구 결과 123명\n\n<script>document.body.dataset.attack=1</script>",
              );
    const upload = () =>
      page
        .getByLabel("학습 자료 파일 선택")
        .setInputFiles({ name, mimeType: "application/octet-stream", buffer });
    await upload();
    const paper = page.locator(".reading-paper");
    await expect(paper).toBeVisible();
    if (kind === "image") {
      await expect(paper.getByRole("img")).toBeVisible();
      expect(
        await paper
          .locator("img")
          .evaluate((el: HTMLImageElement) => el.naturalWidth),
      ).toBe(120);
    } else {
      await expect(paper).toContainText("한국어");
      await expect(paper).toContainText("123명");
      if (kind === "docx" || kind === "hwpx") {
        await expect(
          paper.getByRole("cell", { name: "한국어 표", exact: true }),
        ).toBeVisible();
        await expect(paper.locator("img")).toBeVisible();
      }
      if (["docx", "hwpx", "md"].includes(kind))
        await expect(paper).toContainText("<img src=");
    }
    expect(
      await page.evaluate(() => document.body.dataset.attack),
    ).toBeUndefined();
    expect(outside).toEqual([]);
    const editor = page.getByRole("textbox", { name: "필사 편집기" });
    await expect(editor).toHaveValue("");
    await editor.fill("읽으면서 자유롭게 남긴 필사입니다.");
    await editor.evaluate((el) => {
      el.dataset.stable = "yes";
    });
    await page.getByLabel("문서 확대 비율").selectOption("150");
    await expect(editor).toHaveAttribute("data-stable", "yes");
    await expect(editor).toHaveValue("읽으면서 자유롭게 남긴 필사입니다.");
    if (kind === "hwpx")
      await page.screenshot({ path: info.outputPath("hwpx-reading.png") });
    await expect(page.locator(".save-state")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await page.reload();
    await expect(editor).toHaveValue("읽으면서 자유롭게 남긴 필사입니다.");
    await upload();
    await expect(paper).toBeVisible();
    await expect(editor).toHaveValue("읽으면서 자유롭게 남긴 필사입니다.");
    await page.locator(".export-menu summary").click();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "모든 페이지 TXT" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/\.txt$/);
    expect(outside).toEqual([]);
  });
}
test("긴 텍스트의 원문·필사는 쪽별로 나뉘고 글자 선택·가리기를 유지한다", async ({
  page,
}) => {
  await page.goto("./local/");
  await page.getByLabel("학습 자료 파일 선택").setInputFiles({
    name: "긴자료.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("첫 문단의 한국어 학습자료입니다.\n\n".repeat(500)),
  });
  const editor = page.getByRole("textbox", { name: "필사 편집기" });
  await expect(page.getByLabel("현재 문서 페이지")).toHaveValue("1");
  await editor.fill("1쪽 필사");
  await page
    .locator(".reading-paper p")
    .first()
    .evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
  await page.getByRole("button", { name: "선택한 글에 형광펜" }).click();
  await expect(page.locator(".pdf-highlights span")).toHaveCount(1);
  await page.getByRole("button", { name: "다음 페이지", exact: true }).click();
  await editor.fill("2쪽 필사");
  await page.getByRole("button", { name: "이전 페이지", exact: true }).click();
  await expect(editor).toHaveValue("1쪽 필사");
  await page
    .getByRole("button", { name: "TXT 가리고 필사", exact: true })
    .click();
  await expect(page.locator(".pdf-pane")).toBeHidden();
  await page
    .getByRole("button", { name: "TXT 다시 보기", exact: true })
    .click();
  await expect(editor).toHaveValue("1쪽 필사");
  await page.locator(".reading-paper p").first().click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("현재 문서 페이지")).toHaveValue("2");
  await expect(editor).toHaveValue("2쪽 필사");
});
test("암호 HWP·잘못된 XML·가짜 사진·빈 텍스트를 안내하며 기존 필사를 지킨다", async ({
  page,
}) => {
  await page.goto("./local/");
  const picker = page.getByLabel("학습 자료 파일 선택");
  await picker.setInputFiles({
    name: "노트.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("남길 원문"),
  });
  const editor = page.getByRole("textbox", { name: "필사 편집기" });
  await editor.fill("유실되면 안 되는 필사");
  const { default: Zip } = await import("jszip");
  const broken = await Zip.loadAsync(await officeFixture("docx"));
  broken.file("word/document.xml", "<broken");
  for (const [name, buffer, error] of [
    ["암호.hwp", hwpFixture(true), "암호"],
    ["가짜.png", Buffer.from("not png"), "사진"],
    ["빈노트.txt", Buffer.from("   "), "빈 텍스트"],
    ["손상.docx", Buffer.from("broken"), "손상"],
    [
      "잘못된XML.docx",
      await broken.generateAsync({ type: "nodebuffer" }),
      "XML",
    ],
  ] as const) {
    await picker.setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer,
    });
    await expect(page.locator(".notice.error")).toContainText(error);
    await expect(editor).toHaveValue("유실되면 안 되는 필사");
  }
});

for (const kind of ["docx", "hwpx"] as const) {
  test(`${kind}: 필요한 그림은 다른 폴더에서도 찾고 사용하지 않는 큰 글꼴은 풀지 않는다`, async ({
    page,
  }) => {
    const { default: Zip } = await import("jszip");
    const zip = await Zip.loadAsync(await officeFixture(kind));
    const oldPath =
      kind === "docx" ? "word/media/image1.png" : "BinData/image1.png";
    zip.file(
      "shared/artwork.png",
      await zip.file(oldPath)!.async("uint8array"),
    );
    zip.remove(oldPath);
    const references =
      kind === "docx" ? "word/_rels/document.xml.rels" : "Contents/content.hpf";
    zip.file(
      references,
      (await zip.file(references)!.async("string")).replace(
        kind === "docx" ? "media/image1.png" : "../BinData/image1.png",
        "../shared/artwork.png",
      ),
    );
    if (kind === "hwpx")
      zip.file("Contents/section99.xml", "<unused-invalid-xml");
    const unused = "unused/font.bin";
    zip.file(unused, new Uint8Array(8 * 1024 * 1024));
    const buffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
    });
    // Invalid DEFLATE in an unreferenced font proves the reading view never
    // decompresses it. The complete ZIP directory still passes size/path checks.
    for (let at = 0; at < buffer.length - 30; at++) {
      if (buffer.readUInt32LE(at) !== 0x04034b50) continue;
      const n = buffer.readUInt16LE(at + 26),
        extra = buffer.readUInt16LE(at + 28);
      if (buffer.subarray(at + 30, at + 30 + n).toString() === unused) {
        buffer[at + 30 + n + extra] = 7;
        break;
      }
    }
    await page.goto("./local/");
    await page.getByLabel("학습 자료 파일 선택").setInputFiles({
      name: `한국어.${kind}`,
      mimeType: "application/octet-stream",
      buffer,
    });
    await expect(page.locator(".reading-paper")).toContainText("한국어");
    await expect(page.locator(".reading-paper img")).toBeVisible();
    expect(
      await page
        .locator(".reading-paper img")
        .evaluate((el: HTMLImageElement) => el.naturalWidth),
    ).toBe(120);
  });
}
