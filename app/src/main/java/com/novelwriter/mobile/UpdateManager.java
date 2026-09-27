package com.novelwriter.mobile;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

final class UpdateManager {
    private static final String RELEASE_API = "https://api.github.com/repos/xiaohuangya617/novel-writer-android/releases/latest";
    private static final String ASSET_PREFIX = "https://github.com/xiaohuangya617/novel-writer-android/releases/download/";
    private static final long MAX_APK_BYTES = 150L * 1024 * 1024;
    private final Context context;
    private final Consumer<String> callback;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile Release candidate;
    private volatile File downloaded;
    private volatile boolean cancelDownload;

    UpdateManager(Context context, Consumer<String> callback) {
        this.context = context.getApplicationContext();
        this.callback = callback;
    }

    void check() {
        worker.execute(() -> {
            try {
                candidate = null;
                downloaded = null;
                HttpURLConnection connection = connect(RELEASE_API, false);
                JSONObject data;
                try (InputStream stream = connection.getInputStream()) {
                    data = new JSONObject(readSmall(stream));
                } finally {
                    connection.disconnect();
                }
                if (data.optBoolean("draft") || data.optBoolean("prerelease")) throw new IllegalStateException("暂无正式发布版本");
                String version = data.optString("tag_name").replaceFirst("^[vV]", "");
                PackageInfo installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                if (compareVersions(version, installed.versionName) <= 0) {
                    candidate = null;
                    event("current", "已是最新正式版", null);
                    return;
                }
                JSONArray assets = data.optJSONArray("assets");
                Release found = null;
                if (assets != null) for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.optJSONObject(i);
                    if (asset == null || !asset.optString("name").toLowerCase(Locale.ROOT).endsWith(".apk")) continue;
                    String url = asset.optString("browser_download_url");
                    String digest = asset.optString("digest");
                    long size = asset.optLong("size");
                    if (!url.startsWith(ASSET_PREFIX) || !digest.matches("sha256:[0-9a-fA-F]{64}")
                            || size <= 0 || size > MAX_APK_BYTES) continue;
                    found = new Release(version, data.optString("body"), url, digest.substring(7), size);
                    break;
                }
                if (found == null) throw new IllegalStateException("正式版缺少可校验的 APK，请稍后再试");
                candidate = found;
                JSONObject details = new JSONObject();
                details.put("version", found.version);
                details.put("notes", found.notes.length() > 3000 ? found.notes.substring(0, 3000) + "…" : found.notes);
                details.put("sizeMb", Math.round(found.size * 10.0 / 1048576) / 10.0);
                event("available", null, details);
            } catch (Exception error) {
                event("error", error.getMessage() == null ? "检查更新失败" : error.getMessage(), null);
            }
        });
    }

    void download() {
        Release release = candidate;
        if (release == null) {
            event("error", "请先检查更新", null);
            return;
        }
        cancelDownload = false;
        worker.execute(() -> {
            File temp = null;
            try {
                File folder = new File(context.getCacheDir(), "updates");
                if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("无法创建更新目录");
                temp = File.createTempFile("download-", ".apk", folder);
                HttpURLConnection connection = connect(release.url, true);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0;
                int lastPercent = -1;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temp)) {
                    byte[] buffer = new byte[32768];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (cancelDownload) throw new InterruptedException("下载已取消");
                        received += count;
                        if (received > MAX_APK_BYTES || received > release.size) throw new IllegalStateException("更新包大小不符");
                        digest.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                        int percent = (int) (received * 100 / release.size);
                        if (percent >= lastPercent + 5) {
                            lastPercent = percent;
                            JSONObject progress = new JSONObject();
                            progress.put("percent", percent);
                            event("progress", null, progress);
                        }
                    }
                } finally {
                    connection.disconnect();
                }
                if (cancelDownload) throw new InterruptedException("下载已取消");
                if (received != release.size || !hex(digest.digest()).equalsIgnoreCase(release.sha256)) {
                    throw new IllegalStateException("更新包校验失败，请重新下载");
                }
                verifyApk(temp, release.version);
                File target = new File(folder, "novel-update.apk");
                if (target.exists() && !target.delete()) throw new IllegalStateException("无法替换旧更新包");
                if (!temp.renameTo(target)) throw new IllegalStateException("无法保存更新包");
                temp = null;
                downloaded = target;
                event("downloaded", "下载完成，可以安装", null);
            } catch (InterruptedException error) {
                event("available", "下载已取消", null);
            } catch (Exception error) {
                JSONObject details = new JSONObject();
                try { details.put("canDownload", true); } catch (Exception ignored) { }
                event("error", error.getMessage() == null ? "下载失败" : error.getMessage(), details);
            } finally {
                if (temp != null) temp.delete();
            }
        });
    }

    void cancelDownload() { cancelDownload = true; }

    File downloadedFile() { return downloaded; }

    void shutdown() { cancelDownload = true; worker.shutdownNow(); }

    @SuppressWarnings("deprecation")
    private void verifyApk(File apk, String expectedVersion) throws Exception {
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo current = manager.getPackageInfo(context.getPackageName(), flags);
        PackageInfo update = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (update == null || !context.getPackageName().equals(update.packageName)
                || !expectedVersion.equals(update.versionName)) throw new IllegalStateException("更新包应用信息不匹配");
        long oldCode = Build.VERSION.SDK_INT >= 28 ? current.getLongVersionCode() : current.versionCode;
        long newCode = Build.VERSION.SDK_INT >= 28 ? update.getLongVersionCode() : update.versionCode;
        if (newCode <= oldCode) throw new IllegalStateException("更新包版本号未递增");
        Signature[] oldSigners = Build.VERSION.SDK_INT >= 28 && current.signingInfo != null
                ? current.signingInfo.getApkContentsSigners() : current.signatures;
        Signature[] newSigners = Build.VERSION.SDK_INT >= 28 && update.signingInfo != null
                ? update.signingInfo.getApkContentsSigners() : update.signatures;
        if (oldSigners == null || newSigners == null || oldSigners.length == 0
                || !Arrays.equals(oldSigners, newSigners)) throw new IllegalStateException("更新包签名与当前应用不一致");
    }

    private void event(String status, String message, JSONObject details) {
        try {
            JSONObject result = details == null ? new JSONObject() : details;
            result.put("status", status);
            if (message != null) result.put("message", message);
            callback.accept(result.toString());
        } catch (Exception ignored) { }
    }

    private HttpURLConnection connect(String address, boolean asset) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects < 6; redirects++) {
            String host = url.getHost().toLowerCase(Locale.ROOT);
            boolean trusted = asset ? host.equals("github.com") || host.endsWith(".githubusercontent.com")
                    : host.equals("api.github.com");
            if (!"https".equalsIgnoreCase(url.getProtocol()) || !trusted) throw new IllegalStateException("更新地址不可信");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(12000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "NovelWriter-Android-Updater");
            if (!asset) connection.setRequestProperty("Accept", "application/vnd.github+json");
            int status = connection.getResponseCode();
            if (status == 200) return connection;
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new IllegalStateException("更新地址无效");
                url = new URL(url, location);
                continue;
            }
            connection.disconnect();
            if (status == 404) throw new IllegalStateException("暂无正式发布版本");
            if (status == 403 || status == 429) throw new IllegalStateException("检查次数过多，请稍后再试");
            throw new IllegalStateException("更新服务暂不可用（" + status + "）");
        }
        throw new IllegalStateException("更新地址跳转过多");
    }

    private static String readSmall(InputStream stream) throws Exception {
        byte[] buffer = new byte[8192];
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        int count;
        while ((count = stream.read(buffer)) != -1) {
            if (output.size() + count > 1024 * 1024) throw new IllegalStateException("更新信息过大");
            output.write(buffer, 0, count);
        }
        return output.toString("UTF-8");
    }

    private static int compareVersions(String next, String current) {
        String[] a = next.split("\\.");
        String[] b = current.split("\\.");
        if (a.length < 2 || b.length < 2) throw new IllegalStateException("版本号无效");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int left = i < a.length ? Integer.parseInt(a[i]) : 0;
            int right = i < b.length ? Integer.parseInt(b[i]) : 0;
            if (left != right) return Integer.compare(left, right);
        }
        return 0;
    }

    private static String hex(byte[] bytes) {
        char[] digits = "0123456789abcdef".toCharArray();
        char[] result = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            result[i * 2] = digits[(bytes[i] >> 4) & 15];
            result[i * 2 + 1] = digits[bytes[i] & 15];
        }
        return new String(result);
    }

    private static final class Release {
        final String version;
        final String notes;
        final String url;
        final String sha256;
        final long size;

        Release(String version, String notes, String url, String sha256, long size) {
            this.version = version;
            this.notes = notes;
            this.url = url;
            this.sha256 = sha256;
            this.size = size;
        }
    }
}
