import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { pdfFixture } from "./pdf-fixture";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
test.skip(
  process.env.CLOUD_E2E !== "1",
  "Requires the explicitly configured mock-service test build.",
);
// A protocol fixture, never used by the deployed app. It does not validate real Supabase RLS.
function backend(
  options: {
    legacy?: boolean;
    invalidKey?: boolean;
    missingSetup?: boolean;
  } = {},
) {
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
  const aliases = new Map<string, { owner: string; active: boolean }>();
  const requests: string[] = [];
  let failUpload = false;
  let failWrite = false;
  let failDownload = false;
  let downloadGate: Promise<void> | null = null;
  let releaseDownload: (() => void) | undefined;
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
      access_token: `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.${Buffer.from("test-signature").toString("base64url")}`,
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
      requests.push(path);
      const owner = identity(
        (req.headers().authorization || "").replace("Bearer ", ""),
      );
      const json = (data: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          headers: options.legacy
            ? {}
            : {
                "x-supabase-api-version": "2024-01-01",
                "access-control-expose-headers": "x-supabase-api-version",
              },
          body: JSON.stringify(data),
        });
      if (options.invalidKey) return json({ message: "Invalid API key" }, 401);
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204 });
      if (path.endsWith("/token") || path.endsWith("/signup")) {
        const body = req.postDataJSON();
        let user = users.get(body.email);
        if (path.endsWith("/signup")) {
          if (user)
            return json(
              options.legacy
                ? { message: "User already registered" }
                : { code: "user_already_exists", msg: "already exists" },
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
            options.legacy
              ? { message: "Invalid login credentials" }
              : {
                  code: "invalid_credentials",
                  error_code: "invalid_credentials",
                  msg: "invalid",
                },
            400,
          );
        return json(response(user!));
      }
      if (path.includes("/rpc/")) {
        if (options.missingSetup)
          return json({ code: "PGRST202", message: "function missing" }, 404);
        const operation = path.split("/").at(-1);
        const name = req.postDataJSON()?.p_username;
        const alias = aliases.get(name);
        if (operation === "resolve_study_username")
          return json(
            !alias
              ? { status: "available" }
              : !alias.active
                ? { status: "retired" }
                : {
                    status: "active",
                    email: [...users.values()].find(
                      (u) => u.id === alias.owner,
                    )!.email,
                  },
          );
        if (!owner) return json({ message: "not authenticated" }, 401);
        const own = [...aliases.entries()].find(
          ([, value]) => value.owner === owner && value.active,
        )?.[0];
        if (operation === "current_study_username") return json(own || null);
        if (alias && alias.owner !== owner)
          return json({ message: "username_taken" }, 400);
        if (operation === "register_study_username") {
          if (own && own !== name)
            return json({ message: "username_changed" }, 400);
          const email = `u.${createHash("sha256").update(name).digest("hex")}@accounts.dudada.invalid`;
          if (!own && users.get(email)?.id !== owner)
            return json({ message: "username_changed" }, 400);
        } else if (operation === "rename_study_username") {
          const email = `u.${createHash("sha256").update(name).digest("hex")}@accounts.dudada.invalid`;
          const legacy = users.get(email);
          if (legacy && legacy.id !== owner)
            return json({ message: "username_taken" }, 400);
          if (own) aliases.get(own)!.active = false;
        } else return json({ message: "unknown rpc" }, 404);
        aliases.set(name, { owner, active: true });
        return json(name);
      }
      const user = [...users.values()].find((u) => u.id === owner);
      if (!user) return json({ message: "not authenticated" }, 401);
      if (path.endsWith("/user")) {
        if (req.method() === "PUT") {
          const body = req.postDataJSON();
          if (body.password) user.password = body.password;
        }
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
        if (downloadGate) await downloadGate;
        if (failDownload) return json({ message: "download unavailable" }, 503);
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
    requests,
    notes,
    documents,
    objects,
    writesFail: (value: boolean) => {
      failWrite = value;
    },
    failDownloads: (value: boolean) => {
      failDownload = value;
    },
    holdDownloads: () => {
      downloadGate = new Promise<void>((resolve) => {
        releaseDownload = resolve;
      });
    },
    resumeDownloads: () => {
      releaseDownload?.();
      downloadGate = null;
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

test("오류 코드 없는 인증 응답에서도 가입·재로그인과 잘못된 암호를 처리한다", async ({
  browser,
  baseURL,
}) => {
  const service = backend({ legacy: true });
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  await login(page, "호환계정", "1234");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "호환계정", "1234");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "호환계정", "4321");
  await expect(page.locator(".account-card [role=alert]")).toContainText(
    "아이디 또는 비밀번호",
  );
  await context.close();
});
test("잘못된 연결키는 HTTP 401로 안내하고 신규 가입 요청을 보내지 않는다", async ({
  browser,
  baseURL,
}) => {
  const service = backend({ invalidKey: true });
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  await login(page, "연결오류계정", "1234");
  await expect(page.locator(".account-card [role=alert]")).toContainText(
    "연결키",
  );
  await expect(page.locator(".account-card [role=alert]")).toContainText(
    "HTTP 401",
  );
  expect(service.requests.some((path) => path.endsWith("/signup"))).toBe(false);
  await context.close();
});

test("계정 설정: 4자 암호 확인·아이디 변경·암호 변경 후에도 PDF와 필사를 유지한다", async ({
  browser,
  baseURL,
}, info) => {
  const service = backend();
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  await login(page, "123", "1234");
  await upload(page);
  const editor = page.getByRole("textbox", { name: "필사 편집기" });
  await editor.fill("계정 이름을 바꿔도 남아 있는 필사.");
  await expect(page.locator(".save-state")).toHaveAttribute(
    "data-save-state",
    "saved",
  );
  await editor.evaluate((e) => e.setAttribute("data-kept", "yes"));
  const originalOwner = [...service.notes.values()][0].owner_id;
  await page
    .getByRole("button", { name: "123 계정 설정", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "계정 설정" });
  await dialog.getByLabel("현재 비밀번호", { exact: true }).fill("9999");
  await dialog.getByLabel("새 아이디", { exact: true }).fill("공부하는나");
  await dialog.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(dialog.getByRole("alert")).toContainText("현재 비밀번호가 맞지");
  await dialog.getByLabel("현재 비밀번호", { exact: true }).fill("1234");
  await dialog.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "아이디를 변경했습니다",
  );
  await expect(editor).toHaveAttribute("data-kept", "yes");
  await page.screenshot({ path: info.outputPath("account-settings.png") });
  await dialog.getByRole("button", { name: "계정 설정 닫기" }).click();
  await expect(
    page.getByRole("button", { name: "공부하는나 계정 설정", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "공부하는나 계정 설정", exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue("계정 이름을 바꿔도 남아 있는 필사.");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "123", "1234");
  await expect(page.locator(".account-card [role=alert]")).toContainText(
    "변경 전 아이디",
  );
  await login(page, "공부하는나", "1234");
  await expect(editor).toHaveValue("계정 이름을 바꿔도 남아 있는 필사.");
  await page
    .getByRole("button", { name: "공부하는나 계정 설정", exact: true })
    .click();
  await editor.evaluate((e) => e.setAttribute("data-kept", "password-check"));
  await dialog
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await dialog.getByLabel("현재 비밀번호", { exact: true }).fill("1234");
  await dialog.getByLabel("새 비밀번호", { exact: true }).fill("5678");
  await dialog.getByLabel("새 비밀번호 확인", { exact: true }).fill("5679");
  await dialog.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(dialog.getByRole("alert")).toContainText("서로 다릅니다");
  await dialog.getByLabel("새 비밀번호 확인", { exact: true }).fill("5678");
  await dialog.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "비밀번호를 변경했습니다",
  );
  await expect(editor).toHaveAttribute("data-kept", "password-check");
  await dialog.getByRole("button", { name: "계정 설정 닫기" }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "공부하는나", "1234");
  await expect(page.locator(".account-card [role=alert]")).toContainText(
    "비밀번호를 확인",
  );
  await login(page, "공부하는나", "5678");
  await expect(editor).toHaveValue("계정 이름을 바꿔도 남아 있는 필사.");
  await expect(
    page.getByRole("img", { name: "PDF 원본 1페이지", exact: true }),
  ).toBeVisible();
  expect(service.notes.size).toBe(1);
  expect([...service.notes.values()][0].owner_id).toBe(originalOwner);
  expect(service.documents.size).toBe(1);
  await context.close();
});

test("설정 SQL이 없는 기존 계정도 로그인·비밀번호 변경 가능하고 아이디 변경은 안내한다", async ({
  browser,
  baseURL,
}) => {
  const service = backend({ missingSetup: true });
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  await login(page, "기존계정", "1234");
  await page
    .getByRole("button", { name: "기존계정 계정 설정", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "계정 설정" });
  await dialog.getByLabel("현재 비밀번호", { exact: true }).fill("1234");
  await dialog.getByLabel("새 아이디", { exact: true }).fill("새이름");
  await dialog.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(dialog.getByRole("alert")).toContainText("account-settings.sql");
  await dialog
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await dialog.getByLabel("현재 비밀번호", { exact: true }).fill("1234");
  await dialog.getByLabel("새 비밀번호", { exact: true }).fill("4321");
  await dialog.getByLabel("새 비밀번호 확인", { exact: true }).fill("4321");
  await dialog.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "비밀번호를 변경했습니다",
  );
  await dialog.getByRole("button", { name: "계정 설정 닫기" }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "기존계정", "4321");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await context.close();
});

test("다른 계정 아이디는 가져오지 못하고 모바일 설정에서도 계정 창을 열고 닫는다", async ({
  browser,
  baseURL,
}) => {
  const service = backend();
  const first = await browser.newContext({ baseURL });
  const second = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
  });
  await service.install(first);
  await service.install(second);
  const a = await first.newPage(),
    b = await second.newPage();
  await login(a, "사용중인아이디", "1234");
  await expect(
    a.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await login(b, "내아이디", "4321");
  await b.getByRole("button", { name: "설정", exact: true }).click();
  await b
    .getByRole("button", { name: "아이디·비밀번호 변경", exact: true })
    .click();
  const dialog = b.getByRole("dialog", { name: "계정 설정" });
  await dialog.getByLabel("현재 비밀번호", { exact: true }).fill("4321");
  await dialog.getByLabel("새 아이디", { exact: true }).fill("사용중인아이디");
  await dialog.getByRole("button", { name: "변경 사항 저장" }).click();
  await expect(dialog.getByRole("alert")).toContainText("이미 사용 중");
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await b.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await b
    .getByRole("button", { name: "아이디·비밀번호 변경", exact: true })
    .click();
  await expect(dialog.getByLabel("현재 비밀번호", { exact: true })).toHaveValue(
    "",
  );
  await expect(dialog.getByLabel("새 아이디", { exact: true })).toHaveValue(
    "내아이디",
  );
  await first.close();
  await second.close();
});

test("접속 즉시 마지막 PDF를 불러오고 다운로드 중에는 재연결 화면 없이 필사를 유지한다", async ({
  browser,
  baseURL,
}) => {
  const service = backend();
  const context = await browser.newContext({ baseURL });
  await service.install(context);
  const page = await context.newPage();
  try {
    await login(page, "자동복원계정", "1234");
    await upload(page);
    await page.getByLabel("현재 PDF 페이지").selectOption("3");
    const editor = page.getByRole("textbox", { name: "필사 편집기" });
    await editor.fill("3페이지에 남겨 둔 필사");
    await expect(page.locator(".save-state")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    service.holdDownloads();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "보고 있던 PDF를 불러오고 있어요." }),
    ).toBeVisible();
    await expect(
      page.getByText("필사는 그대로 남아 있어요.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "저장된 PDF 다시 불러오기",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "읽고, 천천히 옮겨 적어요." }),
    ).toHaveCount(0);
    await expect(editor).toHaveValue("3페이지에 남겨 둔 필사");
    await editor.evaluate((e) => e.setAttribute("data-kept", "restoring"));
    await editor.fill("PDF가 열리는 동안에도 자유롭게 필사");
    await expect(page.locator(".save-state")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    service.resumeDownloads();
    await expect(
      page.getByRole("img", { name: "PDF 원본 3페이지", exact: true }),
    ).toBeVisible();
    await expect(editor).toHaveValue("PDF가 열리는 동안에도 자유롭게 필사");
    await expect(editor).toHaveAttribute("data-kept", "restoring");
    await expect(editor).toBeFocused();
    // Only a real load failure exposes the retry action; retry itself runs immediately.
    service.failDownloads(true);
    await page.reload();
    const retry = page.getByRole("button", {
      name: "저장된 PDF 다시 불러오기",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await expect(page.locator(".notice[role=alert]")).toContainText(
      "저장된 PDF를 열지 못했습니다",
    );
    await expect(editor).toHaveValue("PDF가 열리는 동안에도 자유롭게 필사");
    service.failDownloads(false);
    service.holdDownloads();
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "보고 있던 PDF를 불러오고 있어요." }),
    ).toBeVisible();
    service.resumeDownloads();
    await expect(
      page.getByRole("img", { name: "PDF 원본 3페이지", exact: true }),
    ).toBeVisible();
    // A genuinely absent original still offers reconnection instead of spinning forever.
    service.documents.clear();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "원본 PDF 다시 연결", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "보고 있던 PDF를 불러오고 있어요." }),
    ).toHaveCount(0);
    await expect(editor).toHaveValue("PDF가 열리는 동안에도 자유롭게 필사");
  } finally {
    service.resumeDownloads();
    await context.close();
  }
});

test("형광펜·책갈피·이전 버전·PDF 가리기를 같은 계정의 다른 브라우저에서 이어 쓴다", async ({
  browser,
  baseURL,
}) => {
  const service = backend();
  const first = await browser.newContext({ baseURL }),
    second = await browser.newContext({ baseURL });
  await service.install(first);
  await service.install(second);
  const a = await first.newPage(),
    b = await second.newPage();
  try {
    await login(a, "공부도구공유", "1234");
    await upload(a);
    const text = a
      .locator(".pdf-text-layer span")
      .filter({ hasText: "간호사 12 (ICU)." })
      .first();
    await expect(text).toBeVisible();
    await text.evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await a
      .getByRole("button", { name: "선택한 글에 형광펜", exact: true })
      .click();
    await a
      .getByRole("button", { name: "현재 페이지 책갈피", exact: true })
      .click();
    const editor = a.getByRole("textbox", { name: "필사 편집기" });
    const original = "다른 기기에서도 복원할 수 있는 필사 원문입니다.";
    await editor.fill(original);
    await a
      .getByRole("button", { name: "필사 이전 버전", exact: true })
      .click();
    const history = a.getByRole("dialog", { name: "1페이지 이전 버전" });
    await history
      .getByRole("button", { name: "지금 버전 보관", exact: true })
      .click();
    await expect(history.getByLabel("이전 필사 미리보기")).toHaveValue(
      original,
    );
    await history.getByRole("button", { name: "닫기", exact: true }).click();
    await editor.fill("현재 기기에서 고친 글");
    await a
      .getByRole("button", { name: "PDF 가리고 필사", exact: true })
      .click();
    await expect(a.locator(".save-state")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    await login(b, "공부도구공유", "1234");
    await expect(b.getByRole("textbox", { name: "필사 편집기" })).toHaveValue(
      "현재 기기에서 고친 글",
    );
    await expect(
      b.getByRole("region", { name: "PDF 뷰어", exact: true }),
    ).toBeHidden();
    await b.getByRole("button", { name: "PDF 다시 보기", exact: true }).click();
    await expect(b.locator(".pdf-highlights span").first()).toBeVisible();
    await expect(
      b.getByRole("button", { name: "현재 페이지 책갈피", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await b
      .getByRole("button", { name: "필사 이전 버전", exact: true })
      .click();
    const restored = b.getByRole("dialog", { name: "1페이지 이전 버전" });
    await expect(restored.getByLabel("이전 필사 미리보기")).toHaveValue(
      original,
    );
    await restored
      .getByRole("button", { name: "이 버전으로 복원", exact: true })
      .click();
    await expect(b.getByRole("textbox", { name: "필사 편집기" })).toHaveValue(
      original,
    );
    await restored.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(b.locator(".save-state")).toHaveAttribute(
      "data-save-state",
      "saved",
    );
    expect(service.notes.size).toBe(1);
    await b.getByRole("button", { name: "로그아웃", exact: true }).click();
    await login(b, "다른공부도구계정", "1234");
    await expect(
      b.getByRole("heading", { name: "읽고, 천천히 옮겨 적어요." }),
    ).toBeVisible();
    await expect(
      b.getByRole("button", { name: "필사 이전 버전", exact: true }),
    ).toHaveCount(0);
  } finally {
    await first.close();
    await second.close();
  }
});
