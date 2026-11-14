package com.veil.app;

import android.content.Intent;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;

/** Share input is read into memory only; no copy is written to app storage. */
@CapacitorPlugin(name = "VeilIntake")
public class VeilIntakePlugin extends Plugin {
    @Override protected void handleOnNewIntent(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            notifyListeners("sharedImage", new JSObject(), true);
        }
    }
    @PluginMethod public void takeSharedImage(PluginCall call) {
        Intent intent = getActivity().getIntent();
        if (!Intent.ACTION_SEND.equals(intent.getAction())) { call.resolve(new JSObject()); return; }
        Uri uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        intent.removeExtra(Intent.EXTRA_STREAM);
        if (uri == null) { call.resolve(new JSObject()); return; }
        if (!"content".equals(uri.getScheme())) {
            call.reject("Share a local image with Veil."); return;
        }
        getBridge().execute(() -> {
            try {
                String mime = getContext().getContentResolver().getType(uri);
                if (mime == null || !mime.startsWith("image/")) throw new Exception("Not an image.");
                String name = "Shared image";
                try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) {
                        int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                        if (column >= 0) name = cursor.getString(column);
                    }
                }
                try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                     ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    if (input == null) throw new Exception("Unable to open shared image.");
                    byte[] buffer = new byte[65536]; int n;
                    while ((n = input.read(buffer)) != -1) {
                        if (output.size() + n > 32 * 1024 * 1024) throw new Exception("Image exceeds 32 MiB.");
                        output.write(buffer, 0, n);
                    }
                    JSObject result = new JSObject();
                    result.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
                    result.put("name", name); result.put("mime", mime); call.resolve(result);
                }
            } catch (Exception e) { call.reject("Could not open shared image: " + e.getMessage()); }
        });
    }
    /** Explicit export only. Scoped storage needs no broad photo/storage permission on Android 10+. */
    @PluginMethod public void saveCleanPng(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT < 29) { call.reject("Use share on older Android."); return; }
        String data = call.getString("base64");
        String name = call.getString("name", "Veil-clean.png").replaceAll("[^a-zA-Z0-9._-]", "_");
        if (data == null) { call.reject("No exported PNG."); return; }
        String finalName = name;
        getBridge().execute(() -> {
            Uri uri = null;
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                if (bytes.length < 8 || bytes[0] != (byte)137 || bytes[1] != 80 || bytes[2] != 78) {
                    throw new Exception("Only a clean PNG export can be saved.");
                }
                android.content.ContentValues values = new android.content.ContentValues();
                values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME, finalName);
                values.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
                values.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Veil");
                values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 1);
                uri = getContext().getContentResolver().insert(
                    android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new Exception("Could not create export.");
                try (java.io.OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
                    if (output == null) throw new Exception("Could not write export.");
                    output.write(bytes);
                }
                values.clear(); values.put(android.provider.MediaStore.Images.Media.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, values, null, null);
                JSObject result = new JSObject(); result.put("uri", uri.toString()); call.resolve(result);
            } catch (Exception error) {
                if (uri != null) getContext().getContentResolver().delete(uri, null, null);
                call.reject("Could not save clean copy: " + error.getMessage());
            }
        });
    }
}
