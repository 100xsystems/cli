package com.systems.testhelper;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Static file utility methods for 100xSystems Java tests.
 *
 * Provides file existence checks, content reading, and directory listing
 * equivalent to the TypeScript test-suite's helpers.
 *
 * <p>All paths are resolved relative to the project root
 * (working directory / user.dir system property).
 */
public final class FileHelper {

    private FileHelper() {
        // Utility class — prevent instantiation
    }

    /** Resolve a relative path against the project root (user.dir). */
    public static Path projectPath(String first, String... more) {
        return Paths.get(System.getProperty("user.dir"), first, more);
    }

    /** Check if a file exists at the given relative path. */
    public static boolean fileExists(String first, String... more) {
        return Files.exists(projectPath(first, more));
    }

    /** Check if a directory exists at the given relative path. */
    public static boolean dirExists(String first, String... more) {
        Path p = projectPath(first, more);
        return Files.exists(p) && Files.isDirectory(p);
    }

    /** Read a file's content as a UTF-8 string. Throws if the file does not exist. */
    public static String readFile(String first, String... more) {
        try {
            return Files.readString(projectPath(first, more));
        } catch (IOException e) {
            throw new RuntimeException("Failed to read file: " +
                    projectPath(first, more) + " — " + e.getMessage(), e);
        }
    }

    /** Read and parse a JSON string from file. Returns the raw JSON string. */
    public static String readJsonString(String first, String... more) {
        String content = readFile(first, more);
        // Validate it looks like JSON (starts with { or [)
        String trimmed = content.trim();
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
            throw new RuntimeException("File does not contain valid JSON: " +
                    projectPath(first, more) + " — content starts with '" +
                    trimmed.substring(0, Math.min(20, trimmed.length())) + "'");
        }
        return content;
    }

    /**
     * List files in a directory, optionally filtered by extension.
     * Returns relative file names (not full paths), recursively.
     */
    public static List<String> listDir(String dir) {
        return listDir(dir, null);
    }

    /**
     * List files in a directory filtered by extension (e.g., ".java").
     * Returns relative file names (not full paths), recursively.
     */
    public static List<String> listDir(String dir, String extension) {
        Path fullPath = projectPath(dir);
        if (!Files.exists(fullPath) || !Files.isDirectory(fullPath)) {
            return List.of();
        }
        try (Stream<Path> walk = Files.walk(fullPath)) {
            Stream<String> names = walk
                    .filter(Files::isRegularFile)
                    .map(fullPath::relativize)
                    .map(Path::toString);
            if (extension != null && !extension.isEmpty()) {
                names = names.filter(f -> f.endsWith(extension));
            }
            return names.collect(Collectors.toList());
        } catch (IOException e) {
            return List.of();
        }
    }

    /** Check if a file contains the specified substring. */
    public static boolean fileContains(String path, String substring) {
        if (!fileExists(path)) return false;
        return readFile(path).contains(substring);
    }

    /** Check if a file matches the specified regex pattern. */
    public static boolean fileMatches(String path, String regex) {
        if (!fileExists(path)) return false;
        return readFile(path).matches("(?s).*" + regex + ".*");
    }
}
