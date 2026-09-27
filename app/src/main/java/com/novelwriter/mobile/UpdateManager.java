package com.novelwriter.mobile;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

final class UpdateManager {
    private static final String RELEASE_API = "https://api.github.com/repos/xiaohuangya617/novel-writer-android/releases/latest";
    private static final String ASSET_PREFIX = "https://github.com/xiaohuangya617/novel-writer-android/releases/download/";
    private static final long MAX_APK_BYTES = 150L * 1024 * 1024;
    private final Context context;
    private final Consumer<String> callback;
    private final DownloadManager downloads;
    private final SharedPreferences prefs;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Object lock = new Object();
    private volatile Release candidate;
    private volatile long downloadId;
    private volatile long verifiedId = -1;
    private volatile int lastPercent = -1;
    private volatile String lastProgressMessage;
    private volatile long eventGeneration;

    UpdateManager(Context context, Consumer<String> callback) {
        this.context = context.getApplicationContext();
        this.callback = callback;
        downloads = (DownloadManager) this.context.getSystemService(Context.DOWNLOAD_SERVICE);
        prefs = this.context.getSharedPreferences("update_download_v1", Context.MODE_PRIVATE);
        candidate = Release.fromJson(prefs.getString("release", null));
        downloadId = prefs.getLong("downloadId", -1);
        worker.scheduleWithFixedDelay(() -> {
            if (downloadId >= 0 && verifiedId != downloadId) refreshNow();
        }, 1, 1, TimeUnit.SECONDS);
    }

    void refresh() { worker.execute(this::refreshNow); }

    private void refreshNow() {
        long id = downloadId;
        Release release = candidate;
        if (release != null) {
            try {
                PackageInfo installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                if (compareVersions(release.version, installed.versionName) <= 0) {
                    synchronized (lock) {
                        if (downloadId >= 0) downloads.remove(downloadId);
                        downloadId = -1;
                        verifiedId = -1;
                        candidate = null;
                        prefs.edit().remove("downloadId").remove("release").commit();
                    }
                    event("current", "已是最新正式版", null);
                    return;
                }
            } catch (Exception error) {
                event("error", "无法读取当前应用版本", null);
                return;
            }
        }
        if (id >= 0 && release == null) {
            synchronized (lock) {
                if (downloadId == id) {
                    downloadId = -1;
                    prefs.edit().remove("downloadId").commit();
                    downloads.remove(id);
                }
            }
            event("error", "更新信息失效，请重新检查更新", null);
            return;
        }
        if (id < 0 || release == null) {
            if (release != null) available(release, null);
            return;
        }
        try (Cursor result = downloads.query(new DownloadManager.Query().setFilterById(id))) {
            if (result == null || !result.moveToFirst()) {
                failedDownload(id, "更新下载记录已失效，请重新下载");
                return;
            }
            int status = result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                if (verifiedId == id) {
                    if (downloadId != id) return;
                    event("downloaded", "下载完成，可以安装", null);
                    return;
                }
                try {
                    verifyFile(updateFile(release), release);
                    if (downloadId != id) return;
                    verifiedId = id;
                    event("downloaded", "下载完成，可以安装", null);
                } catch (Exception error) {
                    failedDownload(id, "更新包校验失败，请重新下载");
                }
            } else if (status == DownloadManager.STATUS_FAILED) {
                failedDownload(id, downloadFailureMessage(result));
            } else {
                long received = result.getLong(result.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                int percent = (int) Math.min(99, Math.max(0, received * 100 / release.size));
                String message = status == DownloadManager.STATUS_PAUSED ? pausedDownloadMessage(result)
                        : status == DownloadManager.STATUS_PENDING ? "等待系统开始下载" : null;
                if (percent != lastPercent || !java.util.Objects.equals(message, lastProgressMessage)) {
                    if (downloadId != id) return;
                    lastPercent = percent;
                    lastProgressMessage = message;
                    JSONObject details = new JSONObject();
                    details.put("percent", percent);
                    details.put("version", release.version);
                    event("progress", message, details);
                }
            }
        } catch (Exception error) {
            if (downloadId == id) {
                JSONObject details = new JSONObject();
                try { details.put("canCancel", true); } catch (Exception ignored) { }
                event("error", "无法读取下载状态，可以取消下载后重试", details);
            }
        }
    }

    void check() {
        worker.execute(() -> {
            if (downloadId >= 0) {
                refreshNow();
                return;
            }
            try {
                long retryAt = prefs.getLong("retryCheckAt", 0);
                if (retryAt > System.currentTimeMillis()) {
                    throw new IllegalStateException(rateLimitMessage(retryAt, null));
                }
                if (retryAt != 0) prefs.edit().remove("retryCheckAt").apply();
                HttpURLConnection connection = connect(RELEASE_API);
                JSONObject data;
                try (InputStream stream = connection.getInputStream()) {
                    data = new JSONObject(readSmall(stream));
                } finally {
                    connection.disconnect();
                }
                if (data.optBoolean("draft") || data.optBoolean("prerelease")) throw new IllegalStateException("暂无正式发布版本");
                String version = data.optString("tag_name").replaceFirst("^[vV]", "");
                if (!version.matches("[0-9]+(\\.[0-9]+)+")) throw new IllegalStateException("发布版本号无效");
                PackageInfo installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                if (compareVersions(version, installed.versionName) <= 0) {
                    synchronized (lock) {
                        candidate = null;
                        prefs.edit().remove("release").commit();
                    }
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
                synchronized (lock) {
                    if (!prefs.edit().putString("release", found.toJson().toString()).commit()) {
                        throw new IllegalStateException("无法保存更新信息");
                    }
                    candidate = found;
                }
                available(found, null);
            } catch (Exception error) {
                String message = checkFailureMessage(error);
                Release cached = candidate;
                if (cached != null) {
                    try {
                        PackageInfo installed = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
                        if (compareVersions(cached.version, installed.versionName) > 0) {
                            available(cached, message + "；仍可重新下载此前发现的 " + cached.version + " 版本");
                            return;
                        }
                    } catch (Exception ignored) { }
                }
                event("error", message, null);
            }
        });
    }

    void download() { worker.execute(this::downloadNow); }

    private void downloadNow() {
        synchronized (lock) {
            Release release = candidate;
            if (release == null) {
                event("error", "请先检查更新", null);
                return;
            }
            if (downloadId >= 0) {
                refresh();
                return;
            }
            try {
                File target = updateFile(release);
                File folder = target.getParentFile();
                if (folder == null || (!folder.isDirectory() && !folder.mkdirs())) {
                    throw new IllegalStateException("无法创建更新目录");
                }
                if (target.exists() && !target.delete()) throw new IllegalStateException("无法清理旧更新包");
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(release.url));
                request.setTitle("小说生成器 " + release.version);
                request.setMimeType("application/vnd.android.package-archive");
                request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS,
                        "updates/novel-update-" + release.version + ".apk");
                long id = downloads.enqueue(request);
                if (id < 0) throw new IllegalStateException("无法开始下载");
                if (!prefs.edit().putLong("downloadId", id).commit()) {
                    downloads.remove(id);
                    throw new IllegalStateException("无法保存下载状态");
                }
                downloadId = id;
                verifiedId = -1;
                lastPercent = -1;
                lastProgressMessage = null;
                refresh();
            } catch (Exception error) {
                JSONObject details = new JSONObject();
                try { details.put("canDownload", true); } catch (Exception ignored) { }
                event("error", error.getMessage() == null ? "无法开始下载" : error.getMessage(), details);
            }
        }
    }

    void cancelDownload() { worker.execute(this::cancelDownloadNow); }

    private void cancelDownloadNow() {
        synchronized (lock) {
            long id = downloadId;
            if (id < 0) {
                event("error", "没有正在进行的下载", null);
                return;
            }
            try {
                downloads.remove(id);
            } catch (Exception error) {
                JSONObject details = new JSONObject();
                try { details.put("canCancel", true); } catch (Exception ignored) { }
                event("cancelError", "取消下载失败，请稍后重试", details);
                return;
            }
            downloadId = -1;
            eventGeneration++;
            verifiedId = -1;
            lastPercent = -1;
            lastProgressMessage = null;
            prefs.edit().remove("downloadId").commit();
            if (candidate != null) available(candidate, "下载已取消");
            else event("error", "下载已取消，请重新检查更新", null);
        }
    }

    void readyToInstall(Consumer<File> onReady) {
        worker.execute(() -> {
            long id = downloadId;
            Release release = candidate;
            if (id < 0 || release == null) {
                event("downloadMissing", "更新包不存在，请重新下载", null);
                return;
            }
            try (Cursor result = downloads.query(new DownloadManager.Query().setFilterById(id))) {
                if (result == null || !result.moveToFirst() || result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) != DownloadManager.STATUS_SUCCESSFUL) {
                    failedDownload(id, "更新包不存在，请重新下载");
                    return;
                }
                File file = updateFile(release);
                verifyFile(file, release);
                if (downloadId == id) onReady.accept(file);
            } catch (Exception error) {
                failedDownload(id, "更新包校验失败，请重新下载");
            }
        });
    }

    void shutdown() { worker.shutdownNow(); }

    private void failedDownload(long id, String message) {
        synchronized (lock) {
            if (downloadId != id) return;
            downloadId = -1;
            verifiedId = -1;
            lastPercent = -1;
            lastProgressMessage = null;
            prefs.edit().remove("downloadId").commit();
            downloads.remove(id);
            if (candidate != null) available(candidate, message);
            else event("error", message, null);
        }
    }

    private void available(Release release, String message) {
        try {
            JSONObject details = new JSONObject();
            details.put("version", release.version);
            details.put("notes", release.notes.length() > 3000 ? release.notes.substring(0, 3000) + "…" : release.notes);
            details.put("sizeMb", Math.round(release.size * 10.0 / 1048576) / 10.0);
            event("available", message, details);
        } catch (Exception ignored) { }
    }

    private static String checkFailureMessage(Exception error) {
        if (error instanceof SocketTimeoutException) {
            return "连接 GitHub 超时，请检查网络；如当前网络无法访问 GitHub，可开启科学上网后重试";
        }
        if (error instanceof UnknownHostException || error instanceof ConnectException) {
            return "无法连接 GitHub，请检查网络；如当前网络无法访问 GitHub，可开启科学上网后重试";
        }
        return error.getMessage() == null ? "检查更新失败，请稍后重试" : error.getMessage();
    }

    private static String pausedDownloadMessage(Cursor result) {
        int reason = result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
        if (reason == DownloadManager.PAUSED_WAITING_FOR_NETWORK) {
            return "等待网络连接；如当前网络无法访问 GitHub，可开启科学上网后重试";
        }
        if (reason == DownloadManager.PAUSED_QUEUED_FOR_WIFI) return "等待 Wi-Fi 连接";
        if (reason == DownloadManager.PAUSED_WAITING_TO_RETRY) return "网络暂时中断，系统正在重试";
        return "下载已暂停，等待系统继续";
    }

    private static String downloadFailureMessage(Cursor result) {
        int reason = result.getInt(result.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
        if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) return "存储空间不足，请清理空间后重新下载";
        if (reason == DownloadManager.ERROR_DEVICE_NOT_FOUND || reason == DownloadManager.ERROR_FILE_ERROR
                || reason == DownloadManager.ERROR_FILE_ALREADY_EXISTS) return "无法保存更新包，请检查手机存储后重试";
        if (reason == DownloadManager.ERROR_TOO_MANY_REDIRECTS) return "下载地址跳转异常，请稍后重试";
        if (reason == DownloadManager.ERROR_CANNOT_RESUME || reason == DownloadManager.ERROR_HTTP_DATA_ERROR) {
            return "下载连接中断或超时，请检查网络；如当前网络无法访问 GitHub，可开启科学上网后重试";
        }
        if (reason == DownloadManager.ERROR_UNHANDLED_HTTP_CODE) {
            return "下载服务器返回了无法处理的响应，请稍后重试";
        }
        if (reason == 403) return "下载服务器拒绝访问（HTTP 403），请检查当前网络或科学上网后重试";
        if (reason == 404) return "更新包不存在（HTTP 404），请重新检查更新";
        if (reason == 429) return "下载请求过于频繁（HTTP 429），请稍后重试";
        if (reason >= 500 && reason <= 599) return "下载服务器暂不可用（HTTP " + reason + "），请稍后重试";
        if (reason >= 400 && reason <= 499) return "下载请求失败（HTTP " + reason + "），请稍后重试";
        return "下载失败（系统错误码 " + reason + "），请检查网络后重试";
    }

    private File updateFile(Release release) {
        File base = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (base == null) throw new IllegalStateException("更新文件目录不可用");
        return new File(base, "updates/novel-update-" + release.version + ".apk");
    }

    private void verifyFile(File file, Release release) throws Exception {
        if (!file.isFile() || file.length() != release.size) throw new IllegalStateException("更新包大小不符");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32768];
            int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        if (!hex(digest.digest()).equalsIgnoreCase(release.sha256)) throw new IllegalStateException("更新包摘要不符");
        verifyApk(file, release.version);
    }

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
            long generation = eventGeneration;
            String payload = result.toString();
            mainHandler.post(() -> {
                if (generation == eventGeneration) callback.accept(payload);
            });
        } catch (Exception ignored) { }
    }

    private HttpURLConnection connect(String address) throws Exception {
        URL url = new URL(address);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !"api.github.com".equalsIgnoreCase(url.getHost())) {
            throw new IllegalStateException("更新地址不可信");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", "NovelWriter-Android-Updater");
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        int status = connection.getResponseCode();
        if (status == 200) {
            prefs.edit().remove("rateLimitFailures").apply();
            return connection;
        }
        String remaining = connection.getHeaderField("X-RateLimit-Remaining");
        String retryAfter = connection.getHeaderField("Retry-After");
        String reset = connection.getHeaderField("X-RateLimit-Reset");
        boolean primaryLimit = "0".equals(remaining);
        boolean rateLimited = primaryLimit || retryAfter != null;
        String errorMessage = "";
        try {
            if (status == 403 && !rateLimited) {
                InputStream errorStream = connection.getErrorStream();
                if (errorStream != null) try (InputStream stream = errorStream) {
                    errorMessage = new JSONObject(readSmall(stream)).optString("message").toLowerCase(Locale.ROOT);
                } catch (Exception ignored) { }
            }
        } finally {
            connection.disconnect();
        }
        rateLimited |= errorMessage.contains("rate limit") || errorMessage.contains("abuse detection");
        if (status == 404) throw new IllegalStateException("暂无正式发布版本");
        if (status == 429 || status == 403 && rateLimited) {
            long now = System.currentTimeMillis();
            long headerRetryAt = 0;
            try {
                if (retryAfter != null) headerRetryAt = now + Math.min(Long.parseLong(retryAfter), 86_400) * 1000;
            } catch (NumberFormatException ignored) { }
            try {
                if (primaryLimit && reset != null) headerRetryAt = Math.max(headerRetryAt,
                        Math.min(Long.parseLong(reset), (now + 86_400_000) / 1000) * 1000);
            } catch (NumberFormatException ignored) { }
            boolean primaryWaitKnown = primaryLimit && headerRetryAt > now;
            int failures = primaryWaitKnown ? 0 : Math.min(6, Math.max(0, prefs.getInt("rateLimitFailures", 0))) + 1;
            long backoff = primaryWaitKnown ? 60_000 : Math.min(3_600_000L, 60_000L << (failures - 1));
            long retryAt = Math.min(Math.max(now + backoff, headerRetryAt), now + 86_400_000);
            prefs.edit().putLong("retryCheckAt", retryAt).putInt("rateLimitFailures", failures).apply();
            throw new IllegalStateException(rateLimitMessage(retryAt, status));
        }
        prefs.edit().remove("rateLimitFailures").apply();
        if (status == 403) throw new IllegalStateException("GitHub 拒绝检查请求（HTTP 403），请检查当前网络或科学上网后重试");
        throw new IllegalStateException("更新服务暂不可用（" + status + "）");
    }

    private static String rateLimitMessage(long retryAt, Integer status) {
        long seconds = Math.max(1, (retryAt - System.currentTimeMillis() + 999) / 1000);
        String wait = seconds < 60 ? seconds + " 秒" : (seconds + 59) / 60 + " 分钟";
        return "GitHub 暂时限制检查请求" + (status == null ? "" : "（HTTP " + status + "）")
                + "，约 " + wait + "后可重试；共享网络或代理出口也会共用额度";
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

        JSONObject toJson() throws Exception {
            JSONObject data = new JSONObject();
            data.put("version", version);
            data.put("notes", notes);
            data.put("url", url);
            data.put("sha256", sha256);
            data.put("size", size);
            return data;
        }

        static Release fromJson(String raw) {
            try {
                JSONObject data = new JSONObject(raw);
                String version = data.getString("version");
                String url = data.getString("url");
                String sha256 = data.getString("sha256");
                long size = data.getLong("size");
                if (!version.matches("[0-9]+(\\.[0-9]+)+") || !url.startsWith(ASSET_PREFIX)
                        || !sha256.matches("[0-9a-fA-F]{64}") || size <= 0 || size > MAX_APK_BYTES) return null;
                return new Release(version, data.optString("notes"), url, sha256, size);
            } catch (Exception ignored) {
                return null;
            }
        }
    }
}
