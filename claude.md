# JD Tek LLC — Engineering Standards

> This file governs how Claude Code writes, structures, and maintains code across all JD Tek projects.
> Every session must follow these standards without exception. Readable, maintainable, production-grade code only.

---

## 1. Core Philosophy

- **Write for the next engineer, not the current deadline.** Code is read far more than it is written.
- **Explicit over implicit.** If something isn't obvious, make it obvious.
- **One thing at a time.** Functions do one thing. Files own one domain. Modules have one purpose.
- **No mystery code.** If a future engineer can't understand what something does in 30 seconds, rewrite it.
- **Errors are first-class citizens.** Every failure path is handled, logged, and communicated clearly.

---

## 2. TypeScript Standards

### Types

- **No `any`.** Ever. Use `unknown` and narrow it, or define a proper type.
- Every function must have explicit parameter types and return types.
- Use `interface` for object shapes, `type` for unions and primitives.
- Export types that are used across files. Keep types co-located with the code that owns them.

```ts
// ❌ Bad
const processData = (data: any) => {
  return data.result;
};

// ✅ Good
interface ProcessResult {
  success: boolean;
  value: string;
}

const processData = (data: unknown): ProcessResult => {
  if (!isValidData(data)) throw new Error("Invalid data shape");
  return { success: true, value: (data as { result: string }).result };
};
```

### Naming Conventions

| Thing              | Convention            | Example                                         |
| ------------------ | --------------------- | ----------------------------------------------- |
| Variables          | camelCase             | `caseTitle`, `extractedEvents`                  |
| Functions          | camelCase, verb-first | `fetchCase()`, `parseEvents()`, `sendMessage()` |
| Components         | PascalCase            | `LexCounsel`, `TimelineCard`                    |
| Files (components) | PascalCase            | `LexCounsel.tsx`                                |
| Files (utils/lib)  | kebab-case            | `parse-events.ts`, `claude-client.ts`           |
| Constants          | SCREAMING_SNAKE_CASE  | `MAX_TOKENS`, `API_BASE_URL`                    |
| Types/Interfaces   | PascalCase            | `CaseEvent`, `LexCounselProps`                  |
| Booleans           | is/has/should prefix  | `isLoading`, `hasError`, `shouldAutoOpen`       |

### No Magic Values

```ts
// ❌ Bad
const text = fullText.slice(0, 60000);
setTimeout(() => setIsOpen(true), 1500);

// ✅ Good
const MAX_CONTEXT_CHARS = 60000;
const WIDGET_OPEN_DELAY_MS = 1500;

const text = fullText.slice(0, MAX_CONTEXT_CHARS);
setTimeout(() => setIsOpen(true), WIDGET_OPEN_DELAY_MS);
```

---

## 3. Function Standards

- **Maximum 50 lines per function.** If it's longer, break it up.
- **One responsibility per function.** If you need "and" to describe it, split it.
- **Pure functions where possible.** No side effects unless necessary.
- **Early returns over nested conditionals.**

```ts
// ❌ Bad — nested, hard to follow
const processCase = (data: CaseData) => {
  if (data) {
    if (data.events) {
      if (data.events.length > 0) {
        return data.events.map((e) => e.title);
      }
    }
  }
  return [];
};

// ✅ Good — early returns, flat
const processCase = (data: CaseData): string[] => {
  if (!data?.events?.length) return [];
  return data.events.map((event) => event.title);
};
```

---

## 4. File & Folder Structure

### Next.js Projects

```
/app
  /api
    /[route]
      route.ts          # Thin handler only — delegates to services
  /[page]
    page.tsx            # Server component — fetches data, passes to client
/components
  /ui                   # Reusable primitive UI components
  ComponentName.tsx     # Feature components — one component per file
/lib
  claude.ts             # AI client and prompt logic
  db.ts                 # Database client
  [domain].ts           # Domain-specific logic (parsing, validation, etc.)
/types
  index.ts              # Shared types exported from one place
/constants
  index.ts              # All app-level constants
/hooks                  # Custom React hooks
/utils                  # Pure utility functions
```

### Rules

- API routes are **thin handlers only** — no business logic inline.
- Business logic lives in `/lib` service files.
- Database queries belong in `/lib/db.ts` or domain-specific service files.
- Components do not make direct database calls.
- One component per file. No exceptions.

---

## 5. API Route Standards

```ts
// ✅ Correct pattern for all API routes
export async function POST(req: NextRequest) {
  try {
    // 1. Parse and validate input
    const body = await req.json();
    const validated = validateInput(body); // throws if invalid

    // 2. Delegate to service
    const result = await myService.process(validated);

    // 3. Return success
    return NextResponse.json({ data: result });
  } catch (error) {
    // 4. Handle errors explicitly
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[route-name] Unexpected error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
```

- Always validate input before processing.
- Always catch errors — no unhandled promise rejections.
- Log errors with a `[route-name]` prefix so they're traceable.
- Return consistent response shapes: `{ data: ... }` for success, `{ error: ... }` for failure.

---

## 6. React Component Standards

- **Props interfaces are always defined and exported.**
- **No inline styles.** Use Tailwind classes only.
- **No anonymous default exports.** Always name your component.
- **Hooks at the top, handlers in the middle, render at the bottom.**

```tsx
// ✅ Correct component structure
interface TimelineCardProps {
  event: CaseEvent;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}

export default function TimelineCard({
  event,
  isExpanded,
  onToggle,
}: TimelineCardProps) {
  // 1. Hooks
  const [isAnimating, setIsAnimating] = useState(false);

  // 2. Derived state
  const formattedDate = formatDate(event.date);

  // 3. Handlers
  const handleToggle = () => {
    setIsAnimating(true);
    onToggle(event.id);
  };

  // 4. Render
  return (
    <div className="rounded-lg border border-gray-700 p-4">{/* ... */}</div>
  );
}
```

---

## 7. Error Handling

- **Never swallow errors silently.**
- Every `try/catch` must either handle the error meaningfully or re-throw it.
- User-facing errors must be human-readable — not raw exception messages.
- Server errors must be logged with context before responding.

```ts
// ❌ Bad — silent failure
try {
  await doSomething()
} catch (e) {}

// ❌ Bad — leaking internals
catch (error) {
  return NextResponse.json({ error: error.message })
}

// ✅ Good
catch (error) {
  console.error('[lexcounsel] Failed to process message:', error)
  return NextResponse.json(
    { error: 'Unable to process your request. Please try again.' },
    { status: 500 }
  )
}
```

---

## 8. Comments & Documentation

- **Comment the why, not the what.** The code explains what. Comments explain why.
- Every exported function in `/lib` gets a JSDoc comment.
- Complex logic gets an inline comment before the block.
- No commented-out dead code in commits.

```ts
// ❌ Bad comment — restates the code
// Loop through events
events.forEach(event => ...)

// ✅ Good comment — explains intent
// Events must be sorted ascending before rendering — the timeline
// component assumes chronological order and does not re-sort internally
events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

// ✅ Good JSDoc
/**
 * Extracts structured case data from raw PDF text using Claude.
 * Truncates input to MAX_PDF_CHARS to stay within context limits.
 * Throws if the response cannot be parsed as valid CaseData.
 */
export async function extractCaseData(rawText: string): Promise<CaseData> {
```

---

## 9. Database & Prisma Standards

- All Prisma queries live in `/lib` service files — never inline in routes or components.
- Always select only the fields you need — no `findMany()` without a `select` or `include`.
- Migrations are never skipped — schema changes always go through `prisma migrate dev`.
- Sensitive fields (passwords, tokens) are never returned from queries.

```ts
// ❌ Bad — fetches everything, inline in route
const case = await prisma.case.findUnique({ where: { id } })

// ✅ Good — explicit fields, in service file
const case = await prisma.case.findUnique({
  where: { id },
  select: {
    id: true,
    caseTitle: true,
    status: true,
    events: {
      select: { id: true, date: true, title: true, significance: true },
      orderBy: { date: 'asc' }
    }
  }
})
```

---

## 10. Git Commit Standards

Every commit message follows this format:

```
type: short description (max 72 chars)
```

| Type       | When to use                         |
| ---------- | ----------------------------------- |
| `feat`     | New feature                         |
| `fix`      | Bug fix                             |
| `refactor` | Code change with no behavior change |
| `chore`    | Config, deps, tooling               |
| `docs`     | Documentation only                  |
| `test`     | Adding or updating tests            |

**Examples:**

```
feat: add LexCounsel chat widget with auto-open on timeline load
fix: handle null fullText in lexcounsel context builder
refactor: extract case fetching logic into getCaseById service
chore: add prisma migration for fullText column
```

- No "WIP", "stuff", "fix fix fix", or "update" commits in main.
- Each commit should be a coherent, working unit of change.

---

## 11. Environment & Security

- **Never hardcode secrets.** All keys go in `.env.local` and are accessed via `process.env`.
- All `.env` files are in `.gitignore` — always verify before committing.
- Validate that required env vars exist at startup — fail loudly if missing.
- Never log API keys, tokens, or user PII.

```ts
// ✅ Validate env vars at module load time
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  throw new Error("Missing required env var: ANTHROPIC_API_KEY");
}
```

---

## 12. Before Every Commit Checklist

- [ ] No `any` types introduced
- [ ] No magic numbers or strings — constants defined
- [ ] All async functions have error handling
- [ ] No console.logs left in production code (use structured logging)
- [ ] No commented-out code
- [ ] Component props interfaces defined
- [ ] New files follow folder structure conventions
- [ ] Commit message follows the format

---

_These standards apply to all JD Tek LLC projects: JayDe, LexTimeline, JayDe Ecosystem, and any future builds._
_Last updated: June 2026_
