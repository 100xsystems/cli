package com.systems.testhelper;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

/**
 * Build and command execution helpers for 100xSystems Java tests.
 *
 * Provides methods to run Maven builds and shell commands in the project
 * directory, equivalent to the TypeScript test-suite's runBuild / runCommand.
 */
public final class BuildHelper {

    private BuildHelper() {
        // Utility class — prevent instantiation
    }

    /** Timeout for build commands in seconds. */
    private static final int BUILD_TIMEOUT_SECONDS = 120;

    /** Timeout for general commands in seconds. */
    private static final int COMMAND_TIMEOUT_SECONDS = 60;

    /**
     * Run Maven compile and throw if it fails.
     * Equivalent to: mvn compile -q
     */
    public static String runMavenCompile() {
        return runCommand("mvn compile -q");
    }

    /**
     * Run Maven test and throw if it fails.
     * Equivalent to: mvn test -q
     */
    public static String runMavenTest() {
        return runCommand("mvn test -q");
    }

    /**
     * Assert that Maven compile succeeds.
     * Throws AssertionError with a descriptive message if compilation fails.
     */
    public static void expectBuildSucceeds() {
        try {
            runMavenCompile();
        } catch (RuntimeException e) {
            throw new AssertionError("Maven build failed: " + e.getMessage(), e);
        }
    }

    /**
     * Run a shell command in the project directory and return stdout.
     * Throws RuntimeException if the command exits with non-zero.
     */
    public static String runCommand(String command) {
        return runCommand(command, COMMAND_TIMEOUT_SECONDS);
    }

    /**
     * Run a shell command with a custom timeout and return stdout.
     * Throws RuntimeException if the command exits with non-zero or times out.
     */
    public static String runCommand(String command, int timeoutSeconds) {
        String projectDir = System.getProperty("user.dir");
        try {
            ProcessBuilder pb = new ProcessBuilder();
            pb.directory(new File(projectDir));

            // Use shell-based execution
            if (System.getProperty("os.name").toLowerCase().contains("win")) {
                pb.command("cmd.exe", "/c", command);
            } else {
                pb.command("sh", "-c", command);
            }

            pb.redirectErrorStream(true);
            Process process = pb.start();

            // Read stdout
            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append(System.lineSeparator());
                }
            }

            boolean finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                throw new RuntimeException("Command timed out after " + timeoutSeconds + "s: " + command);
            }

            int exitCode = process.exitValue();
            if (exitCode != 0) {
                throw new RuntimeException("Command failed with exit code " + exitCode + ": " + command
                        + System.lineSeparator() + output);
            }

            return output.toString().trim();
        } catch (IOException e) {
            throw new RuntimeException("Failed to run command: " + command + " — " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("Command was interrupted: " + command, e);
        }
    }
}
