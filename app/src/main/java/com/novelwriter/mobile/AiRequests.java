package com.novelwriter.mobile;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.AtomicFile;

import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.Set;

final class AiRequests {
    interface Callback { void complete(String id, String response); }
    private static final int MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

    private final Context context;
    private static AiRequests shared;
    private volatile Callback callback;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object serviceLock = new Object();
    private final Map<String, Request> requests = new ConcurrentHashMap<>();
    private final Set<String> cancelledBeforeStart = ConcurrentHashMap.newKeySet();

    private static final class Request {
        volatile HttpURLConnection connection;
        volatile boolean cancelled;
        final boolean durable;
        Request(boolean durable) { this.durable = durable; }
    }

    static synchronized AiRequests shared(Context context) {
        if (shared == null || shared.executor.isShutdown()) shared = new AiRequests(context);
        return shared;
    }

    private AiRequests(Context context) {
        this.context = context.getApplicationContext();
    }

    void attach(Callback listener) { callback = listener; }
    void detach(Callback listener) { if (callback == listener) callback = null; }

    void submit(String id, String endpoint, String apiKey, String body, int timeoutMs, boolean durable) {
        Request request = new Request(durable);
        synchronized (serviceLock) {
            if (cancelledBeforeStart.remove(id)) return;
            if (requests.putIfAbsent(id, request) != null) return;
            Intent intent = new Intent(context, AiForegroundService.class);
            try {
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
                else context.startService(intent);
                executor.execute(() -> run(id, endpoint, apiKey, body, Math.max(15000, timeoutMs), request));
            } catch (RuntimeException error) {
                requests.remove(id);
                if (requests.isEmpty()) context.stopService(intent);
                JSONObject result = new JSONObject();
                try { result.put("error", "无法启动后台任务：" + error.getMessage()); }
                catch (Exception ignored) { }
                Callback listener = callback;
                if (listener != null) listener.complete(id, result.toString());
            }
        }
    }

    void cancel(String id) {
        synchronized (serviceLock) {
            resultFile(id).delete();
            Request request = requests.get(id);
            if (request == null) { cancelledBeforeStart.add(id); return; }
            request.cancelled = true;
            if (request.connection != null) request.connection.disconnect();
        }
    }

    void shutdown() {
        synchronized (serviceLock) {
            for (String id : requests.keySet()) cancel(id);
            cancelledBeforeStart.clear();
            executor.shutdownNow();
            context.stopService(new Intent(context, AiForegroundService.class));
        }
    }

    void replay(String id) {
        String response;
        synchronized (serviceLock) {
            if (requests.containsKey(id)) return;
            response = readResult(id);
        }
        if (response == null) response = "{\"error\":\"后台任务已中断，请重试\"}";
        Callback listener = callback;
        if (listener != null) listener.complete(id, response);
    }

    void acknowledge(String id) {
        synchronized (serviceLock) { resultFile(id).delete(); }
    }

    private File resultFile(String id) {
        if (!id.matches("[a-zA-Z0-9.-]{1,80}")) throw new IllegalArgumentException("请求编号无效");
        File folder = new File(context.getFilesDir(), "pending_ai");
        if (!folder.exists()) folder.mkdirs();
        return new File(folder, id + ".json");
    }

    private boolean saveResult(String id, String response) {
        AtomicFile file = new AtomicFile(resultFile(id));
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(response.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
            return true;
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
            return false;
        }
    }

    private String readResult(String id) {
        try (FileInputStream stream = new AtomicFile(resultFile(id)).openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int count;
            while ((count = stream.read(chunk)) != -1) output.write(chunk, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) { return null; }
    }

    private void run(String id, String endpoint, String apiKey, String body, int timeoutMs, Request request) {
        JSONObject result = new JSONObject();
        try {
            if (request.cancelled) return;
            URL url = new URL(endpoint);
            String host = url.getHost();
            if (!"https".equals(url.getProtocol()) && !("http".equals(url.getProtocol())
                    && ("localhost".equals(host) || "127.0.0.1".equals(host)))) {
                throw new IllegalArgumentException("API 地址必须使用 HTTPS");
            }
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            request.connection = connection;
            if (request.cancelled) return;
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(Math.min(timeoutMs, 30000));
            connection.setReadTimeout(timeoutMs);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Authorization", "Bearer " + apiKey);
            if (request.cancelled) return;
            try (OutputStream stream = connection.getOutputStream()) {
                stream.write(body.getBytes(StandardCharsets.UTF_8));
            }
            int status = connection.getResponseCode();
            InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            String payload = "";
            if (stream != null) {
                try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] chunk = new byte[8192];
                    int count;
                    while ((count = input.read(chunk)) != -1) {
                        if (request.cancelled) return;
                        if (output.size() + count > MAX_RESPONSE_BYTES) {
                            throw new IllegalStateException("AI 返回内容超过 20 MB");
                        }
                        output.write(chunk, 0, count);
                    }
                    payload = output.toString(StandardCharsets.UTF_8.name());
                }
            }
            result.put("status", status);
            result.put("body", payload);
        } catch (Exception error) {
            try { result.put("error", request.cancelled ? "请求已停止" : error.getMessage()); }
            catch (Exception ignored) { }
        } finally {
            if (request.connection != null) request.connection.disconnect();
            String response = result.toString();
            synchronized (serviceLock) {
                if (!request.cancelled && request.durable && !saveResult(id, response)) {
                    response = "{\"error\":\"AI 结果暂存失败，请保持应用打开\"}";
                }
                requests.remove(id);
                if (requests.isEmpty()) context.stopService(new Intent(context, AiForegroundService.class));
            }
            Callback listener = callback;
            if (!request.cancelled && listener != null) listener.complete(id, response);
        }
    }
}
