package com.novelwriter.mobile;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.net.Uri;
import android.graphics.Color;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://app.local";
    private static final int EXPORT_FILE = 101;
    private static final int IMPORT_FILE = 102;
    private static final int UPDATE_PERMISSION = 103;
    private static final String PENDING_EXPORT_FILE = "pending_export_file";
    private static final String PENDING_EXPORT_LABEL = "pending_export_label";
    private WebView webView;
    private SecureStore store;
    private AiRequests requests;
    private UpdateManager updater;
    private final AiRequests.Callback requestCallback = this::deliverRequest;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private File pendingExportFile;
    private String pendingExportLabel;
    private boolean pageReady;
    private String pendingFileFunction;
    private String pendingFileValue;
    private String pendingUpdateEvent;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) {
            String name = state.getString(PENDING_EXPORT_FILE);
            if (name != null && name.startsWith("pending-export-") && name.endsWith(".tmp")
                    && !name.contains("/") && !name.contains("\\")) {
                File file = new File(getFilesDir(), name);
                if (file.isFile()) pendingExportFile = file;
            }
            pendingExportLabel = state.getString(PENDING_EXPORT_LABEL);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        store = new SecureStore(this);
        updater = new UpdateManager(this, event -> runOnUiThread(() -> sendUpdateEvent(event)));
        requests = AiRequests.shared(this);
        requests.attach(requestCallback);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!"app.local".equals(request.getUrl().getHost())) return null;
                String path = request.getUrl().getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..")) return new WebResourceResponse("text/plain", "UTF-8", null);
                try {
                    InputStream stream = getAssets().open(path.substring(1));
                    String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css"
                            : path.endsWith(".js") ? "application/javascript" : path.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
                    return new WebResourceResponse(mime, "UTF-8", stream);
                } catch (Exception error) {
                    return new WebResourceResponse("text/plain", "UTF-8", null);
                }
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (APP_ORIGIN.equals(uri.getScheme() + "://" + uri.getHost())) return false;
                if ("https".equals(uri.getScheme()) && "github.com".equals(uri.getHost())
                        && "/xiaohuangya617/novel-writer-android".equals(uri.getPath())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (ActivityNotFoundException error) {
                        Toast.makeText(MainActivity.this, "没有可用的浏览器", Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }
        });
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(32, 50, 46));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            Insets keyboard = insets.getInsets(WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        setContentView(root);
        webView.loadUrl(APP_ORIGIN + "/index.html");
    }

    private String backupName(String format) {
        return "小说项目_" + format + "_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(new Date()) + ".json";
    }

    private void exportProject(String json) {
        exportFile(json, backupName("App"), "application/json", "App 项目存档已导出");
    }

    private void exportBookText(String content, String bookName) {
        String safeName = bookName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (safeName.isEmpty()) safeName = "本书";
        if (safeName.length() > 60) safeName = safeName.substring(0, 60);
        exportFile(content, safeName + "_正文.txt", "text/plain", "本书正文已导出");
    }

    private void exportFile(String content, String fileName, String mime, String label) {
        if (pendingExportFile != null) {
            sendFileEvent("window.nativeBackupError", "请先完成当前导出");
            return;
        }
        File file = null;
        try {
            file = File.createTempFile("pending-export-", ".tmp", getFilesDir());
            try (FileOutputStream stream = new FileOutputStream(file)) {
                stream.write(content.getBytes(StandardCharsets.UTF_8));
            }
            pendingExportFile = file;
            pendingExportLabel = label;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mime);
            intent.putExtra(Intent.EXTRA_TITLE, fileName);
            startActivityForResult(intent, EXPORT_FILE);
        } catch (Exception error) {
            if (file != null) file.delete();
            pendingExportFile = null;
            pendingExportLabel = null;
            sendFileEvent("window.nativeBackupError", error.getMessage());
        }
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (pendingExportFile != null) {
            state.putString(PENDING_EXPORT_FILE, pendingExportFile.getName());
            state.putString(PENDING_EXPORT_LABEL, pendingExportLabel);
        }
    }

    private void chooseProject() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        startActivityForResult(intent, IMPORT_FILE);
    }

    private void shareProject(String json, String format) {
        files.execute(() -> { try {
            File folder = new File(getCacheDir(), "shared");
            if (!folder.exists() && !folder.mkdirs()) throw new IllegalStateException("无法建立分享目录");
            File[] oldFiles = folder.listFiles();
            if (oldFiles != null) for (File old : oldFiles) {
                if (old.isFile() && old.lastModified() < System.currentTimeMillis() - 86400000L) old.delete();
            }
            File file = new File(folder, backupName(format).replace(".json", "_" + System.nanoTime() + ".json"));
            try (FileOutputStream stream = new FileOutputStream(file)) {
                stream.write(json.getBytes(StandardCharsets.UTF_8));
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", file);
            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.setClipData(ClipData.newRawUri("小说项目存档（" + format + "）", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            runOnUiThread(() -> {
                try {
                    startActivity(Intent.createChooser(intent, "分享小说项目"));
                } catch (Exception error) {
                    sendFileEvent("window.nativeBackupError", error.getMessage());
                }
            });
        } catch (Exception error) {
            runOnUiThread(() -> sendFileEvent("window.nativeBackupError", error.getMessage()));
        } });
    }

    private void installUpdate() {
        updater.readyToInstall(apk -> runOnUiThread(() -> {
            if (!isDestroyed() && !isFinishing()) launchInstaller(apk);
        }));
    }

    private void launchInstaller(File apk) {
        try {
            if (!getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                startActivityForResult(settings, UPDATE_PERMISSION);
                updateMessage("permission", "请允许此应用安装更新，返回后继续安装");
                return;
            }
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.setClipData(ClipData.newRawUri("小说生成器更新包", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
            updateMessage("installing", "请在系统界面确认安装");
        } catch (Exception error) {
            updateMessage("installError", error.getMessage() == null ? "无法打开系统安装器" : error.getMessage());
        }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == EXPORT_FILE) {
            File source = pendingExportFile;
            String label = pendingExportLabel;
            pendingExportFile = null;
            pendingExportLabel = null;
            if (resultCode != RESULT_OK || data == null) {
                if (source != null) source.delete();
                return;
            }
            if (source == null || !source.isFile()) {
                sendFileEvent("window.nativeBackupError", "导出内容已失效，请重新导出");
                return;
            }
            Uri target = data.getData();
            files.execute(() -> { try {
                try (InputStream input = new FileInputStream(source);
                     OutputStream stream = getContentResolver().openOutputStream(target)) {
                    if (stream == null) throw new IllegalStateException("无法写入选定文件");
                    byte[] chunk = new byte[8192];
                    int count;
                    while ((count = input.read(chunk)) != -1) stream.write(chunk, 0, count);
                }
                runOnUiThread(() -> sendFileEvent("window.nativeExportSaved", label));
            } catch (Exception error) {
                runOnUiThread(() -> sendFileEvent("window.nativeBackupError", error.getMessage()));
            } finally {
                source.delete();
            } });
        } else if (requestCode == IMPORT_FILE && resultCode == RESULT_OK && data != null) {
            Uri source = data.getData();
            files.execute(() -> { try (InputStream stream = getContentResolver().openInputStream(source)) {
                if (stream == null) throw new IllegalStateException("无法读取选定文件");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int count;
                while ((count = stream.read(chunk)) != -1) {
                    if (output.size() + count > 30 * 1024 * 1024) throw new IllegalArgumentException("存档超过 30 MB");
                    output.write(chunk, 0, count);
                }
                String imported = output.toString(StandardCharsets.UTF_8.name());
                runOnUiThread(() -> sendFileEvent("window.nativeBackupImported", imported));
            } catch (Exception error) {
                runOnUiThread(() -> sendFileEvent("window.nativeBackupError", error.getMessage()));
            } });
        } else if (requestCode == UPDATE_PERMISSION) {
            if (getPackageManager().canRequestPackageInstalls()) installUpdate();
            else updateMessage("permission", "需要允许此应用安装更新，才能继续");
        }
    }

    private void sendToPage(String function, String value) {
        if (webView != null) webView.evaluateJavascript(function + "(" + JSONObject.quote(value == null ? "操作失败" : value) + ")", null);
    }

    private void sendFileEvent(String function, String value) {
        if (!pageReady) {
            pendingFileFunction = function;
            pendingFileValue = value;
            return;
        }
        sendToPage(function, value);
    }

    private void sendUpdateEvent(String value) {
        if (!pageReady) {
            pendingUpdateEvent = value;
            return;
        }
        sendToPage("window.nativeUpdateEvent", value);
    }

    private void updateMessage(String status, String message) {
        try {
            JSONObject event = new JSONObject();
            event.put("status", status);
            event.put("message", message);
            sendUpdateEvent(event.toString());
        } catch (Exception ignored) { }
    }

    private void markPageReady() {
        pageReady = true;
        if (pendingFileFunction != null) {
            sendToPage(pendingFileFunction, pendingFileValue);
            pendingFileFunction = null;
            pendingFileValue = null;
        }
        if (pendingUpdateEvent != null) {
            sendToPage("window.nativeUpdateEvent", pendingUpdateEvent);
            pendingUpdateEvent = null;
        }
    }

    private void deliverRequest(String id, String response) {
        runOnUiThread(() -> {
            if (webView == null) return;
            webView.evaluateJavascript("window.nativeRequestComplete(" + JSONObject.quote(id)
                    + "," + JSONObject.quote(response) + ")", null);
        });
    }

    @Override public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("window.androidBack ? window.androidBack() : false", value -> {
                if (!"true".equals(value)) finish();
            });
        } else {
            super.onBackPressed();
        }
    }

    @Override public void onDestroy() {
        if (requests != null) {
            requests.detach(requestCallback);
            if (isFinishing()) requests.shutdown();
        }
        files.shutdown();
        if (updater != null) updater.shutdown();
        if (isFinishing() && pendingExportFile != null) pendingExportFile.delete();
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private final class Bridge {
        @JavascriptInterface public void pageReady() { runOnUiThread(MainActivity.this::markPageReady); }
        @JavascriptInterface public String appVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception error) { return "未知"; }
        }
        @JavascriptInterface public void checkUpdate() { updater.check(); }
        @JavascriptInterface public void refreshUpdate() { updater.refresh(); }
        @JavascriptInterface public void downloadUpdate() { updater.download(); }
        @JavascriptInterface public void cancelUpdateDownload() { updater.cancelDownload(); }
        @JavascriptInterface public void installUpdate() { runOnUiThread(MainActivity.this::installUpdate); }
        @JavascriptInterface public String loadProject() { return store.loadProject(); }
        @JavascriptInterface public boolean hasProject() { return store.hasProject(); }
        @JavascriptInterface public boolean saveProject(String json) { return store.saveProject(json); }
        @JavascriptInterface public String loadApiSettings(String fallbackConfig) { return store.loadApiSettings(fallbackConfig); }
        @JavascriptInterface public boolean saveApiSettings(String json) { return store.saveApiSettings(json); }
        @JavascriptInterface public void request(String id, String url, String key, String body, int timeoutMs, boolean durable) {
            runOnUiThread(() -> requests.submit(id, url, key, body, timeoutMs, durable));
        }
        @JavascriptInterface public void cancel(String id) { requests.cancel(id); }
        @JavascriptInterface public void exitApp() { runOnUiThread(MainActivity.this::finish); }
        @JavascriptInterface public void replayRequest(String id) { requests.replay(id); }
        @JavascriptInterface public void acknowledgeRequest(String id) { requests.acknowledge(id); }
        @JavascriptInterface public void exportProject(String json) { runOnUiThread(() -> MainActivity.this.exportProject(json)); }
        @JavascriptInterface public void exportBookText(String content, String name) { runOnUiThread(() -> MainActivity.this.exportBookText(content, name)); }
        @JavascriptInterface public void shareProject(String json) { runOnUiThread(() -> MainActivity.this.shareProject(json, "App")); }
        @JavascriptInterface public void shareHtmlProject(String json) { runOnUiThread(() -> MainActivity.this.shareProject(json, "HTML")); }
        @JavascriptInterface public void chooseProject() { runOnUiThread(MainActivity.this::chooseProject); }
    }
}
