import _ from "lodash";
import path from "path";
import * as glob from "glob";
import { CLIError } from "./errors";
import { I18nConfig, resolveOverridenLocale, BucketItem } from "@lingo.dev/~spec";
import { bucketTypeSchema } from "@lingo.dev/~spec";
import Z from "zod";

export function getBuckets(i18nConfig: I18nConfig) {
  const result = Object.entries(i18nConfig.buckets).map(([bucketType, bucketEntry]) => {
    const includeItems = bucketEntry.include.map((item) => resolveBucketItem(item));
    const excludeItems = bucketEntry.exclude?.map((item) => resolveBucketItem(item));
    return {
      type: bucketType as Z.infer<typeof bucketTypeSchema>,
      config: extractPathPatterns(i18nConfig.locale.source, includeItems, excludeItems),
    };
  });

  return result;
}

function extractPathPatterns(sourceLocale: string, include: BucketItem[], exclude?: BucketItem[]) {
  const includedPatterns = include.flatMap((pattern) =>
    expandPlaceholderedGlob(pattern.path, resolveOverridenLocale(sourceLocale, pattern.delimiter)).map(
      (pathPattern) => ({
        pathPattern,
        delimiter: pattern.delimiter,
      }),
    ),
  );
  const excludedPatterns = exclude?.flatMap((pattern) =>
    expandPlaceholderedGlob(pattern.path, resolveOverridenLocale(sourceLocale, pattern.delimiter)).map(
      (pathPattern) => ({
        pathPattern,
        delimiter: pattern.delimiter,
      }),
    ),
  );
  const result = _.differenceBy(includedPatterns, excludedPatterns ?? [], (item) => item.pathPattern);
  return result;
}

// Path expansion
function expandPlaceholderedGlob(_pathPattern: string, sourceLocale: string): string[] {
  // Throw if pathPattern is an absolute path
  const absolutePathPattern = path.resolve(_pathPattern);
  const pathPattern = path.relative(process.cwd(), absolutePathPattern);
  // Throw if pathPattern points outside the current working directory
  if (path.relative(process.cwd(), pathPattern).startsWith("..")) {
    throw new CLIError({
      message: `Invalid path pattern: ${pathPattern}. Path pattern must be within the current working directory.`,
      docUrl: "invalidPathPattern",
    });
  }
  // Throw error if pathPattern contains "**" – we don't support recursive path patterns
  if (pathPattern.includes("**")) {
    throw new CLIError({
      message: `Invalid path pattern: ${pathPattern}. Recursive path patterns are not supported.`,
      docUrl: "invalidPathPattern",
    });
  }
  // Throw error if pathPattern contains "[locale]" several times
  if (pathPattern.split("[locale]").length > 2) {
    throw new CLIError({
      message: `Invalid path pattern: ${pathPattern}. Path pattern must contain at most one "[locale]" placeholder.`,
      docUrl: "invalidPathPattern",
    });
  }
  // Break down path pattern into parts
  const pathPatternChunks = pathPattern.split(path.sep);
  // Find the index of the segment containing "[locale]"
  const localeSegmentIndex = pathPatternChunks.findIndex((segment) => segment.includes("[locale]"));
  // Find the position of the "[locale]" placeholder within the segment
  const localePlaceholderIndex = pathPatternChunks[localeSegmentIndex]?.indexOf("[locale]") ?? -1;
  // substitute [locale] in pathPattern with sourceLocale
  const sourcePathPattern = pathPattern.replace(/\[locale\]/g, sourceLocale);
  // get all files that match the sourcePathPattern
  const sourcePaths = glob
    .sync(sourcePathPattern, { follow: true, withFileTypes: true })
    .filter((file) => file.isFile() || file.isSymbolicLink())
    .map((file) => file.fullpath())
    .map((fullpath) => path.relative(process.cwd(), fullpath));
  // transform each source file path back to [locale] placeholder paths
  const placeholderedPaths = sourcePaths.map((sourcePath) => {
    const sourcePathChunks = sourcePath.split(path.sep);
    if (localeSegmentIndex >= 0 && localePlaceholderIndex >= 0) {
      const placeholderedPathChunk = sourcePathChunks[localeSegmentIndex];
      const placeholderedSegment =
        placeholderedPathChunk.substring(0, localePlaceholderIndex) +
        "[locale]" +
        placeholderedPathChunk.substring(localePlaceholderIndex + sourceLocale.length);
      sourcePathChunks[localeSegmentIndex] = placeholderedSegment;
    }
    const placeholderedPath = sourcePathChunks.join(path.sep);
    return placeholderedPath;
  });
  // return the placeholdered paths
  return placeholderedPaths;
}

function resolveBucketItem(bucketItem: string | BucketItem): BucketItem {
  if (typeof bucketItem === "string") {
    return { path: bucketItem, delimiter: null };
  }
  return bucketItem;
}
