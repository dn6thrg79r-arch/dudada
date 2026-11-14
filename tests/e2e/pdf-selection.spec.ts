import { test, expect } from "@playwright/test";
import { newspaperPdfFixture } from "./pdf-fixture";
for (const legacyGuard of [false, true]) {
  test.describe(
    legacyGuard
      ? "Safari 호환 보정 경로 (Chromium에서도 분기 검사)"
      : "기본 선택 경로",
    () => {
      if (legacyGuard)
        test.use({
          userAgent:
            "Mozilla/5.0 AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
        });
      test("신문 기사 아래 빈 공간으로 드래그해도 위 기사로 선택이 튀지 않는다", async ({
        page,
      }) => {
        await page.goto("./local/");
        await page.getByLabel("PDF 파일 선택").setInputFiles({
          name: "신문형_선택검사.pdf",
          mimeType: "application/pdf",
          buffer: await newspaperPdfFixture(),
        });
        const layer = page.locator(".pdf-text-layer");
        const first = layer
          .locator("span")
          .filter({ hasText: "RIGHT article line 1" })
          .first();
        const last = layer
          .locator("span")
          .filter({ hasText: "RIGHT article line 5" })
          .first();
        await expect(first).toBeVisible();
        for (const zoom of ["fit", "150", "200"]) {
          await page.getByLabel("PDF 확대 비율").selectOption(zoom);
          await last.evaluate((e) =>
            e.scrollIntoView({ block: "center", inline: "center" }),
          );
          const a = (await first.boundingBox())!,
            b = (await last.boundingBox())!;
          await page.mouse.move(a.x + 2, a.y + a.height / 2);
          await page.mouse.down();
          await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, {
            steps: 30,
          });
          await expect
            .poll(() => page.evaluate(() => window.getSelection()?.toString()))
            .toContain("RIGHT article line 5");
          // Stay in the same column while moving below its text, as in the recording.
          await page.mouse.move(b.x + b.width - 2, b.y + b.height + 26, {
            steps: 15,
          });
          const selected = await page.evaluate(
            () => window.getSelection()?.toString() || "",
          );
          expect(selected).toContain("RIGHT article line 1");
          expect(selected).toContain("RIGHT article line 5");
          expect(selected).not.toContain("UPPER");
          expect(selected).not.toContain("LEFT");
          await page.mouse.up();
          await expect(layer).not.toHaveClass(/selecting/);
        }
      });
    },
  );
}
