package com.systems.testhelper;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Base test class for 100xSystems Java curriculum lessons.
 *
 * Extend this class in every lesson test to get:
 * <ul>
 *   <li>File existence and content assertions</li>
 *   <li>File reading utilities</li>
 *   <li>Build verification ({@link #expectBuildSucceeds()})</li>
 *   <li>Temporary directory support ({@link #withTempDir(ThrowingConsumer)})</li>
 *   <li>Temporary file support ({@link #withTempFile(String, String, ThrowingConsumer)})</li>
 * </ul>
 *
 * <p>Equivalent to importing from {@code @100xsystems/test-suite-typescript}
 * in the TypeScript curriculum.
 *
 * <h3>Usage Example</h3>
 * <pre>{@code
 * import com.systems.testhelper.BaseTest;
 * import org.junit.jupiter.api.Test;
 *
 * class Lesson1Test extends BaseTest {
 *     {@literal @}Test
 *     void hasPackageJson() {
 *         assertFileExists("pom.xml");
 *     }
 *
 *     {@literal @}Test
 *     void buildsSuccessfully() {
 *         expectBuildSucceeds();
 *     }
 * }
 * }</pre>
 */
public abstract class BaseTest {

    // ─── File Assertions ────────────────────────────────────────────

    /** Assert that a file exists at the given relative path. */
    protected void assertFileExists(String first, String... more) {
        assertTrue(FileHelper.fileExists(first, more),
                "Expected file to exist: " + resolvePath(first, more));
    }

    /** Assert that a file does NOT exist at the given relative path. */
    protected void assertFileNotExists(String first, String... more) {
        assertFalse(FileHelper.fileExists(first, more),
                "Expected file to NOT exist: " + resolvePath(first, more));
    }

    /** Assert that a directory exists at the given relative path. */
    protected void assertDirExists(String first, String... more) {
        assertTrue(FileHelper.dirExists(first, more),
                "Expected directory to exist: " + resolvePath(first, more));
    }

    /** Assert that a file contains the specified substring. */
    protected void assertFileContains(String path, String substring) {
        assertTrue(FileHelper.fileContains(path, substring),
                "Expected file '" + path + "' to contain: " + substring);
    }

    /** Assert that a file does NOT contain the specified substring. */
    protected void assertFileNotContains(String path, String substring) {
        assertFalse(FileHelper.fileContains(path, substring),
                "Expected file '" + path + "' to NOT contain: " + substring);
    }

    /** Assert that a file matches the specified regex pattern. */
    protected void assertFileMatches(String path, String regex) {
        assertTrue(FileHelper.fileMatches(path, regex),
                "Expected file '" + path + "' to match regex: " + regex);
    }

    /** Assert that a file has minimum content length. */
    protected void assertFileHasContent(String path) {
        assertFileExists(path);
        String content = FileHelper.readFile(path);
        assertTrue(content.trim().length() > 0,
                "Expected file '" + path + "' to have content, but it was empty.");
    }

    // ─── File Reading ───────────────────────────────────────────────

    /** Read a file's content as a UTF-8 string. */
    protected String readFile(String first, String... more) {
        return FileHelper.readFile(first, more);
    }

    /** Read and parse a JSON file. Returns the raw JSON string for manual parsing. */
    protected String readJsonString(String first, String... more) {
        return FileHelper.readJsonString(first, more);
    }

    // ─── Build Verification ─────────────────────────────────────────

    /** Assert that Maven compile succeeds. */
    protected void expectBuildSucceeds() {
        BuildHelper.expectBuildSucceeds();
    }

    /** Run a shell command and return stdout. */
    protected String runCommand(String command) {
        return BuildHelper.runCommand(command);
    }

    /** Run Maven compile and return stdout. */
    protected String runMavenCompile() {
        return BuildHelper.runMavenCompile();
    }

    /** Run Maven test and return stdout. */
    protected String runMavenTest() {
        return BuildHelper.runMavenTest();
    }

    // ─── Temp Directory Helpers ─────────────────────────────────────

    /**
     * Functional interface for operations that can throw.
     */
    @FunctionalInterface
    public interface ThrowingConsumer<T> {
        void accept(T t) throws Exception;
    }

    /**
     * Create a temporary directory, pass it to the callback, and clean up
     * when the callback completes.
     *
     * @param fn callback that receives the Path to the temp directory
     */
    protected void withTempDir(ThrowingConsumer<Path> fn) {
        withTempDir(fn, "100x-test-");
    }

    /**
     * Create a temporary directory with a custom prefix, pass it to the
     * callback, and clean up when the callback completes.
     *
     * @param fn     callback that receives the Path to the temp directory
     * @param prefix directory name prefix
     */
    protected void withTempDir(ThrowingConsumer<Path> fn, String prefix) {
        try {
            Path tempDir = Files.createTempDirectory(prefix);
            try {
                fn.accept(tempDir);
            } finally {
                deleteRecursively(tempDir);
            }
        } catch (Exception e) {
            throw new RuntimeException("withTempDir failed", e);
        }
    }

    /**
     * Create a temporary file with the given content, pass its path to the
     * callback, and clean up when the callback completes.
     *
     * @param name    the filename (e.g., "test.txt")
     * @param content the content to write
     * @param fn      callback that receives the absolute Path to the temp file
     */
    protected void withTempFile(String name, String content, ThrowingConsumer<Path> fn) {
        try {
            Path tempDir = Files.createTempDirectory("100x-test-file-");
            try {
                Path filePath = tempDir.resolve(name);
                Files.writeString(filePath, content);
                fn.accept(filePath);
            } finally {
                deleteRecursively(tempDir);
            }
        } catch (Exception e) {
            throw new RuntimeException("withTempFile failed", e);
        }
    }

    // ─── Internals ──────────────────────────────────────────────────

    private String resolvePath(String first, String... more) {
        return FileHelper.projectPath(first, more).toString();
    }

    private void deleteRecursively(Path path) throws IOException {
        if (Files.isDirectory(path)) {
            try (var stream = Files.list(path)) {
                stream.forEach(p -> {
                    try {
                        deleteRecursively(p);
                    } catch (IOException ignored) {
                    }
                });
            }
        }
        Files.deleteIfExists(path);
    }
}
