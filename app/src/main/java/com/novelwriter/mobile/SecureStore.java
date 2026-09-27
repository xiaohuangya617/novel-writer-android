package com.novelwriter.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import android.util.Base64;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import org.json.JSONObject;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class SecureStore {
    private static final String KEY_ALIAS = "novel_api_key_v1";
    private static final String PREFS = "private_settings";
    private static final String KEY_CIPHER = "api_key_cipher";
    private static final String KEY_CONFIG = "api_config_json";
    private final Context context;
    private final AtomicFile project;

    SecureStore(Context context) {
        this.context = context.getApplicationContext();
        project = new AtomicFile(new File(this.context.getFilesDir(), "project.json"));
    }

    synchronized String loadProject() {
        try (FileInputStream stream = project.openRead(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int count;
            while ((count = stream.read(chunk)) != -1) output.write(chunk, 0, count);
            return output.toString(StandardCharsets.UTF_8.name());
        } catch (Exception error) {
            return null;
        }
    }

    synchronized boolean hasProject() {
        return project.getBaseFile().exists();
    }

    synchronized boolean saveProject(String json) {
        FileOutputStream stream = null;
        try {
            stream = project.startWrite();
            stream.write(json.getBytes(StandardCharsets.UTF_8));
            project.finishWrite(stream);
            return true;
        } catch (Exception error) {
            if (stream != null) project.failWrite(stream);
            return false;
        }
    }

    synchronized String loadApiKey() {
        try {
            String encoded = context.getSharedPreferences(PREFS, 0).getString(KEY_CIPHER, "");
            if (encoded == null || encoded.isEmpty()) return "";
            byte[] value = Base64.decode(encoded, Base64.NO_WRAP);
            byte[] iv = new byte[12];
            System.arraycopy(value, 0, iv, 0, iv.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, encryptionKey(), new GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(value, iv.length, value.length - iv.length), StandardCharsets.UTF_8);
        } catch (Exception error) {
            return "";
        }
    }

    synchronized String loadApiSettings(String fallbackConfig) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS, 0);
            String config = prefs.getString(KEY_CONFIG, null);
            JSONObject settings = new JSONObject(config == null ? fallbackConfig : config);
            settings.put("key", loadApiKey());
            return settings.toString();
        } catch (Exception error) {
            return null;
        }
    }

    synchronized boolean saveApiSettings(String json) {
        try {
            JSONObject settings = new JSONObject(json);
            String plainText = settings.optString("key", "");
            settings.remove("key");
            SharedPreferences.Editor edit = context.getSharedPreferences(PREFS, 0).edit();
            if (plainText.isEmpty()) {
                edit.remove(KEY_CIPHER);
            } else {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
                byte[] encrypted = cipher.doFinal(plainText.getBytes(StandardCharsets.UTF_8));
                byte[] iv = cipher.getIV();
                byte[] combined = new byte[iv.length + encrypted.length];
                System.arraycopy(iv, 0, combined, 0, iv.length);
                System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
                edit.putString(KEY_CIPHER, Base64.encodeToString(combined, Base64.NO_WRAP));
            }
            return edit.putString(KEY_CONFIG, settings.toString()).commit();
        } catch (Exception error) {
            return false;
        }
    }

    private SecretKey encryptionKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }
}
