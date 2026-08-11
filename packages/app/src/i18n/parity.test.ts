import { describe, expect, test } from "bun:test"

const appLocales = [
  "ar",
  "br",
  "bs",
  "da",
  "de",
  "es",
  "fr",
  "ja",
  "ko",
  "no",
  "pl",
  "ru",
  "uk",
  "th",
  "tr",
  "zh",
  "zht",
  "hi",
  "nl",
  "id",
  "vi",
  "it",
  "ur",
  "pa",
  "az",
  "fi",
  "sv",
  "am",
  "bg",
  "bn",
  "ca",
  "cs",
  "dv",
  "dz",
  "el",
  "et",
  "fa",
  "fo",
  "hr",
  "hu",
  "hy",
  "is",
  "ka",
  "km",
  "lo",
  "lt",
  "lv",
  "mk",
  "mn",
  "ms",
  "my",
  "ne",
  "ro",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "tg",
  "tk",
  "uz",
] as const
const desktopLocales = appLocales
const pluralCategories = new Set(["zero", "one", "two", "few", "many", "other"])
const appFallbackKeys = new Set([
  "dialog.provider.custom.label",
  "dialog.model.unpaid.viewMoreProviders",
  "session.header.reveal.finder",
  "session.header.reveal.fileExplorer",
  "session.header.reveal.containingFolder",
  "command.session.export",
  "command.session.export.description",
  "context.export.session",
  "toast.session.export.success.title",
  "toast.session.export.success.description",
  "toast.session.export.failed.title",
  "toast.session.export.failed.description",
  "common.export",
  "settings.tab.preferences",
  "settings.tab.notifications",
  "settings.tab.projects",
  "settings.tab.extensions",
  "settings.preferences.description",
  "settings.appearance.description",
  "settings.notifications.description",
  "settings.shortcuts.description",
  "settings.servers.description",
  "settings.projects.title",
  "settings.projects.description",
  "settings.projects.empty",
  "settings.projects.server.all",
  "settings.mcps.description",
  "settings.extensions.description",
  "settings.extensions.tab.mcps",
  "settings.extensions.tab.skills",
  "settings.extensions.availableAll",
  "settings.extensions.manageConfig",
  "settings.extensions.addSkills",
  "settings.general.section.general",
  "dialog.server.authenticate.title",
  "project.settings.general.description",
  "project.settings.scripts",
  "project.settings.scripts.description",
  "project.settings.extensions.description",
  "project.settings.extensions.tab.lsps",
  "project.settings.extensions.added",
  "project.settings.extensions.shared",
  "project.settings.extensions.lsp.detected",
  "project.settings.extensions.setupRequired",
])

const domains = [
  {
    name: "app",
    source: "./en.ts",
    target: (locale: string) => `./${locale}.ts`,
    locales: appLocales,
  },
  {
    name: "ui",
    source: "../../../ui/src/i18n/en.ts",
    target: (locale: string) => `../../../ui/src/i18n/${locale}.ts`,
    locales: appLocales,
  },
  {
    name: "desktop",
    source: "../../../desktop/src/renderer/i18n/en.ts",
    target: (locale: string) => `../../../desktop/src/renderer/i18n/${locale}.ts`,
    locales: desktopLocales,
  },
] as const

describe("i18n parity", () => {
  test("non-English locales contain only English keys and their plural variants", async () => {
    for (const domain of domains) {
      const source = await dictionary(domain.source)
      const families = new Set(pluralFamilies(source))
      for (const locale of domain.locales) {
        const target = await dictionary(domain.target(locale))
        const extra = Object.keys(target)
          .filter((key) => !Object.hasOwn(source, key) && !isPluralVariant(key, families))
          .sort()
        expect({ domain: domain.name, locale, extra }).toEqual({
          domain: domain.name,
          locale,
          extra: [],
        })
      }
    }
  })

  test("non-English locales preserve English placeholders", async () => {
    for (const domain of domains) {
      const source = await dictionary(domain.source)
      for (const locale of domain.locales) {
        const target = await dictionary(domain.target(locale))
        const mismatched = Object.keys(source).filter(
          (key) => Object.hasOwn(target, key) && placeholders(source[key]).join() !== placeholders(target[key]).join(),
        )
        const pluralMismatched = Object.keys(target).filter((key) => {
          const family = pluralFamily(key)
          if (!family || !Object.hasOwn(source, `${family}.other`)) return false
          return placeholders(source[`${family}.other`]).join() !== placeholders(target[key]).join()
        })
        expect({ domain: domain.name, locale, mismatched, pluralMismatched }).toEqual({
          domain: domain.name,
          locale,
          mismatched: [],
          pluralMismatched: [],
        })
      }
    }
  })

  test("non-English locales translate targeted unseen session keys", async () => {
    const source = await dictionary("./en.ts")
    for (const locale of appLocales) {
      const target = await dictionary(`./${locale}.ts`)
      for (const key of ["command.session.previous.unseen", "command.session.next.unseen"]) {
        expect(target[key]).toBeDefined()
        expect(target[key]).not.toBe(source[key])
      }
    }
  })

  test("changed-file summary keys preserve rendered English copy and localize complete phrases", async () => {
    const source = await dictionary("../../../ui/src/i18n/en.ts")
    expect(source["ui.sessionTurn.diffs.changed.one"].replace("{{count}}", "1")).toBe("1 Changed file")
    expect(source["ui.sessionTurn.diffs.changed.other"].replace("{{count}}", "2")).toBe("2 Changed files")
    expect(source["ui.sessionTurn.diffs.changed"]).toBeUndefined()

    for (const locale of appLocales) {
      const target = await dictionary(`../../../ui/src/i18n/${locale}.ts`)
      for (const key of ["ui.sessionTurn.diffs.changed.one", "ui.sessionTurn.diffs.changed.other"]) {
        expect(target[key].trim()).not.toBe("")
        expect(placeholders(target[key])).toEqual(["count"])
      }
    }
  })
})

async function dictionary(file: string) {
  const module: unknown = await import(file)
  if (typeof module !== "object" || module === null || !("dict" in module) || !isDictionary(module.dict)) {
    throw new Error(`Invalid translation dictionary: ${file}`)
  }
  return module.dict
}

function isDictionary(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === "string")
}

function placeholders(value: string) {
  return Array.from(value.matchAll(/{{\s*([^}]+?)\s*}}/g), (match) => match[1]).sort()
}

function pluralFamilies(dictionary: Record<string, string>) {
  return Object.keys(dictionary)
    .filter((key) => key.endsWith(".one") && Object.hasOwn(dictionary, `${key.slice(0, -4)}.other`))
    .map((key) => key.slice(0, -4))
}

function pluralFamily(key: string) {
  const split = key.lastIndexOf(".")
  if (split === -1 || !pluralCategories.has(key.slice(split + 1))) return
  return key.slice(0, split)
}

function isPluralVariant(key: string, families: Set<string>) {
  const family = pluralFamily(key)
  return family !== undefined && families.has(family)
}
