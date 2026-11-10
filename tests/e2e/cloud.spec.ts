import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { pdfFixture } from "./pdf-fixture";
import { writeFile } from "node:fs/promises";
test.skip(
  process.env.CLOUD_E2E !== "1",
  "Requires the explicitly configured mock-service test build.",
);
// A protocol fixture, never used by the deployed app. It does not validate real Supabase RLS.
function backend() {
  type User = {
    id: string;
    email: string;
    password: string;
    user_metadata: { display_name: string };
    aud: string;
  };
  const users = new Map<string, User>(),
    notes = new Map<
      string,
      { id: string; owner_id: string; payload: unknown; revision: number }
    >(),
    documents = new Map<string, unknown>(),
    objects = new Map<string, Buffer>();
  let failUpload = false;
  let failWrite = false;
  function identity(token: string) {
    try {
      return JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      ).sub as string;
    } catch {
      return "";
    }
  }
  function response(user: User) {
    const { password: _, ...publicUser } = user;
    void _;
    const encoded = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    return {
      access_token: `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`,
      refresh_token: `refresh-${user.id}`,
      expires_in: 3600,
      token_type: "bearer",
      user: publicUser,
    };
  }
  async function install(context: BrowserContext) {
    await context.route("https://cloud-test.supabase.co/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        path = url.pathname;
      const owner = identity(
        (req.headers().authorization || "").replace("Bearer ", ""),
      );
      const json = (data: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: {
            "x-supabase-api-version": "2024-01-01",
            "access-control-expose-headers": "x-supabase-api-version",
          },
          body: JSON.stringify(data),
        });
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204 });
      if (path.endsWith("/token") || path.endsWith("/signup")) {
        const body = req.postDataJSON();
        let user = users.get(body.email);
        if (path.endsWith("/signup")) {
          if (user)
            return json(
              { code: "user_already_exists", msg: "already exists" },
              422,
            );
          user = {
            id: `00000000-0000-4000-8000-${String(users.size + 1).padStart(12, "0")}`,
            email: body.email,
            password: body.password,
            user_metadata: body.data || {},
            aud: "authenticated",
          };
          users.set(body.email, user);
        } else if (!user || body.password !== user.password)
          return json(
            {
              code: "invalid_credentials",
              error_code: "invalid_credentials",
              msg: "invalid",
            },
            400,
          );
        return json(response(user!));
      }
      const user = [...users.values()].find((u) => u.id === owner);
      if (!user) return json({ message: "not authenticated" }, 401);
      if (path.endsWith("/user")) {
        const { password: _, ...data } = user;
        void _;
        return json(data);
      }
      if (path.endsWith("/logout")) return json({});
      if (path.startsWith("/rest/v1/")) {
        const table = path.split("/").at(-1)!;
        if (failWrite && req.method() !== "GET")
          return json({ message: "network unavailable" }, 503);
        const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
        const filterOwner = (url.searchParams.get("owner_id") || "").replace(
          /^eq\./,
          "",
        );
        if (filterOwner && filterOwner !== owner) return json([]);
        const store = table === "study_notebooks" ? notes : documents;
        if (req.method() === "GET") {
          const rows = [...store.values()].filter((row) => {
            const r = row as { id: string; owner_id: string };
            return r.owner_id === owner && (!id || r.id === id);
          });
          return json(rows);
        }
        if (req.method() === "POST") {
          const body = req.postDataJSON();
          if (body.owner_id !== owner) return json({ message: "RLS" }, 403);
          const key = owner + ":" + body.id;
          if (table === "study_notebooks") {
            if (notes.has(key)) return json({ message: "duplicate" }, 409);
            const row = { ...body, revision: 1 };
            notes.set(key, row);
            return json(
              req.headers().accept?.includes("object+json") ? row : [row],
              201,
            );
          }
          documents.set(key, body);
          return json(null, 201);
        }
        const key = owner + ":" + id;
        if (req.method() === "PATCH") {
          const row = notes.get(key);
          const expected = Number(
            (url.searchParams.get("revision") || "").replace(/^eq\./, ""),
          );
          if (!row || row.revision !== expected) return json([]);
          const next = { ...row, ...req.postDataJSON() };
          notes.set(key, next);
          return json([next]);
        }
        if (req.method() === "DELETE") {
          store.delete(key);
          return json(null);
        }
      }
      if (path.startsWith("/storage/v1/object/")) {
        const marker = "/study-pdfs";
        const offset = path.indexOf(marker);
        const key = decodeURIComponent(path.slice(offset + marker.length + 1));
        if (req.method() === "DELETE") {
          const body = req.postDataJSON();
          for (const prefix of body.prefixes) {
            if (!prefix.startsWith(owner + "/"))
              return json({ message: "RLS" }, 403);
            objects.delete(prefix);
          }
          return json([]);
        }
        if (!key.startsWith(owner + "/")) return json({ message: "RLS" }, 403);
        if (req.method() === "POST") {
          if (failUpload) return json({ message: "quota exceeded" }, 413);
          let bytes = req.postDataBuffer()!;
          const contentType = req.headers()["content-type"] || "";
          if (contentType.includes("multipart/form-data")) {
            const boundary = contentType.split("boundary=")[1];
            const filename = bytes.indexOf(Buffer.from('filename="'));
            const start = bytes.indexOf(Buffer.from("\r\n\r\n"), filename) + 4;
            const end = bytes.indexOf(Buffer.from("\r\n--" + boundary), start);
            bytes = bytes.subarray(start, end);
          }
          objects.set(key, bytes);
          return json({ Key: "study-pdfs/" + key });
        }
        const data = objects.get(key);
        if (!data) return json({ message: "missing" }, 404);
        return route.fulfill({
          contentType: "application/octet-stream",
          body: data,
        });
      }
      return json({ message: "unexpected mock request" }, 404);
    });
  }
  return {
    install,
    notes,
    documents,
    objects,
    writesFail: (value: boolean) => {
      failWrite = value;
    },
    failUploads: () => {
      failUpload = true;
    },
  };
}
async function login(page: Page, name: string, password = "study-password") {
  await page.goto("./");
  await page.getByLabel("아이디", { exact: true }).fill(name);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page.getByRole("button", { name: "들어가기", exact: true }).click();
}
async function upload(page: Page) {
  await page.getByLabel("PDF 파일 선택").setInputFiles({
    name: "소식지.pdf",
    mimeType: "application/pdf",
    buffer: await pdfFixture(),
  });
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("PDF 파일 선택")).toBeEnabled();
}
test("새 계정 → PDF·필사 저장 → 독립 브라우저 로그인·PDF 복원 → 다른 계정 분리", async ({
  browser,
  baseURL,
}) => {
  const service = backend();
  const a = await browser.newContext({ baseURL }),
    b = await browser.newContext({ baseURL });
  await service.install(a);
  await service.install(b);
  const first = await a.newPage(),
    second = await b.newPage();
  await login(first, "공부계정1");
  await expect(
    first.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await upload(first);
  await first
    .getByRole("textbox", { name: "필사 편집기" })
    .fill("Mac에서 작성한 한국어 필사 ICU 12명.");
  await expect(first.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  expect(service.objects.size).toBeGreaterThan(0);
  await login(second, "공부계정1");
  await expect(
    second.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("textbox", { name: "필사 편집기" }),
  ).toHaveValue("Mac에서 작성한 한국어 필사 ICU 12명.");
  await second.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(second, "공부계정1", "wrong-password");
  await expect(second.locator(".account-card [role=alert]")).toContainText(
    "아이디 또는 비밀번호",
  );
  await expect(
    second.getByRole("textbox", { name: "필사 편집기" }),
  ).toHaveCount(0);
  await login(second, "공부계정2");
  await expect(
    second.getByRole("heading", { name: "읽고, 천천히 옮겨 적어요." }),
  ).toBeVisible();
  await expect(
    second.getByRole("textbox", { name: "필사 편집기" }),
  ).toHaveCount(0);
  expect(service.notes.size).toBe(1);
  await a.close();
  await b.close();
});
test("PDF 저장 실패는 성공으로 표시하지 않고 필사 편집을 유지한다", async ({
  browser,
  baseURL,
}) => {
  const service = backend();
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  await login(page, "저장실패계정");
  service.failUploads();
  await upload(page);
  await expect(
    page.locator(".notice[role=alert]").filter({ hasText: "PDF 저장에 실패" }),
  ).toBeVisible();
  expect(service.documents.size).toBe(0);
  await page
    .getByRole("textbox", { name: "필사 편집기" })
    .fill("PDF 저장 실패 후에도 글은 작성 가능");
  await expect(page.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  await context.close();
});

test("미동기화 글을 같은 계정의 브라우저에 보관하고 연결 복구 후 저장한다", async ({
  browser,
  baseURL,
}) => {
  const service = backend();
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  await login(page, "복구계정");
  await upload(page);
  await expect(page.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  service.writesFail(true);
  await page
    .getByRole("textbox", { name: "필사 편집기" })
    .fill("인터넷이 끊겨도 복구할 글");
  await expect(page.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "error",
  );
  service.writesFail(false);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole("textbox", { name: "필사 편집기" })).toHaveValue(
    "인터넷이 끊겨도 복구할 글",
  );
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  await context.close();
});

test("101MB PDF를 여러 조각으로 저장하고 다른 브라우저에서 복원한다", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120000);
  const service = backend();
  const firstContext = await browser.newContext({ baseURL }),
    secondContext = await browser.newContext({ baseURL });
  await service.install(firstContext);
  await service.install(secondContext);
  const first = await firstContext.newPage(),
    second = await secondContext.newPage();
  await login(first, "큰파일계정");
  await expect(first.getByLabel("PDF 파일 선택")).toBeEnabled({
    timeout: 60000,
  });
  const path = info.outputPath("큰소식지.pdf");
  await writeFile(path, await pdfFixture(false, true));
  await first.getByLabel("PDF 파일 선택").setInputFiles(path);
  await expect(first.getByLabel("PDF 파일 선택")).toBeEnabled({
    timeout: 60000,
  });
  await expect.poll(() => service.objects.size).toBe(11);
  await expect.poll(() => service.documents.size).toBe(1);
  await login(second, "큰파일계정");
  await expect(
    second.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await second.getByLabel("현재 PDF 페이지").selectOption("8");
  await expect(
    second.getByRole("img", { name: "PDF 원본 8페이지", exact: true }),
  ).toBeVisible({ timeout: 60000 });
  await firstContext.close();
  await secondContext.close();
});

test("4자 암호로 가입·재로그인하고 3자는 제출하지 않으며 기존 암호 오류를 구분한다", async ({
  browser,
  baseURL,
}) => {
  const service = backend();
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  await page.goto("./");
  await page.getByLabel("아이디", { exact: true }).fill("짧은암호계정");
  const password = page.getByLabel("비밀번호", { exact: true });
  await expect(password).toHaveAttribute("minlength", "4");
  await password.fill("123");
  await page.getByRole("button", { name: "들어가기", exact: true }).click();
  expect(
    await password.evaluate((e: HTMLInputElement) => e.validity.tooShort),
  ).toBe(true);
  await expect(page.getByRole("textbox", { name: "필사 편집기" })).toHaveCount(
    0,
  );
  await password.fill("1234");
  await page.getByRole("button", { name: "들어가기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "짧은암호계정", "1234");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "짧은암호계정", "4321");
  await expect(page.locator(".account-card [role=alert]")).toContainText(
    "아이디 또는 비밀번호",
  );
  await context.close();
});
