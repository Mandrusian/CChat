#include "raylib.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <curl/curl.h>

#define RENDER_URL "https://cchat-backend-002b.onrender.com"

typedef enum { SCREEN_LOGIN, SCREEN_SET_USERNAME, SCREEN_CHAT } AppScreen;

typedef struct {
    char email[128];
    char password[128];
    char username[128];
    bool is_signup_mode;
} AuthState;

typedef struct {
    char active_recipient[128];
    char active_recipient_email[128];
    bool show_new_chat_modal;
    char search_query[128];
    char suggestions[5][128];
    int suggestion_count;
} ChatState;

struct MemoryStruct {
    char *memory;
    size_t size;
};

static size_t WriteMemoryCallback(void *contents, size_t size, size_t nmemb, void *userp) {
    size_t realsize = size * nmemb;
    struct MemoryStruct *mem = (struct MemoryStruct *)userp;
    char *ptr = realloc(mem->memory, mem->size + realsize + 1);
    if (!ptr) return 0;
    mem->memory = ptr;
    memcpy(&(mem->memory[mem->size]), contents, realsize);
    mem->size += realsize;
    mem->memory[mem->size] = 0;
    return realsize;
}

char raw_server_log[256] = "Server status: Ready";

bool Network_Auth(const char* email, const char* password, bool is_signup) {
    CURL *curl_handle = curl_easy_init();
    if (!curl_handle) return false;

    struct MemoryStruct chunk = { malloc(1), 0 };
    char json_payload[512];
    snprintf(json_payload, sizeof(json_payload), "{\"email\":\"%s\",\"password\":\"%s\"}", email, password);

    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    char full_url[256];
    snprintf(full_url, sizeof(full_url), "%s/api/%s", RENDER_URL, is_signup ? "register" : "login");

    curl_easy_setopt(curl_handle, CURLOPT_URL, full_url);
    curl_easy_setopt(curl_handle, CURLOPT_POSTFIELDS, json_payload);
    curl_easy_setopt(curl_handle, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl_handle, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl_handle, CURLOPT_SSL_VERIFYPEER, 0L);
    curl_easy_setopt(curl_handle, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
    curl_easy_setopt(curl_handle, CURLOPT_WRITEDATA, (void *)&chunk);
    curl_easy_setopt(curl_handle, CURLOPT_TIMEOUT, 10L);

    CURLcode res = curl_easy_perform(curl_handle);
    bool success = false;

    if (res == CURLE_OK && chunk.memory) {
        snprintf(raw_server_log, sizeof(raw_server_log), "RESP: %s", chunk.memory);
        if (strstr(chunk.memory, "\"success\":true")) {
            success = true;
        }
    } else {
        snprintf(raw_server_log, sizeof(raw_server_log), "ERR: %s", curl_easy_strerror(res));
    }

    curl_easy_cleanup(curl_handle);
    curl_slist_free_all(headers);
    if (chunk.memory) free(chunk.memory);

    return success;
}

// Snappy Key-Repeat Buffer Backspace
void HandleTextInput(char *buffer, int max_len, float *backspace_timer) {
    int key = GetCharPressed();
    while (key > 0) {
        if ((key >= 32) && (key <= 126) && (int)strlen(buffer) < max_len - 1) {
            int len = strlen(buffer);
            buffer[len] = (char)key;
            buffer[len + 1] = '\0';
        }
        key = GetCharPressed();
    }

    if (IsKeyDown(KEY_BACKSPACE)) {
        *backspace_timer += GetFrameTime();
        if (IsKeyPressed(KEY_BACKSPACE) || *backspace_timer > 0.3f) {
            int len = strlen(buffer);
            if (len > 0) buffer[len - 1] = '\0';
            if (*backspace_timer > 0.3f) *backspace_timer = 0.25f; // Fast repeat
        }
    } else {
        *backspace_timer = 0.0f;
    }
}

int main() {
    curl_global_init(CURL_GLOBAL_ALL);
    SetConfigFlags(FLAG_WINDOW_HIGHDPI | FLAG_MSAA_4X_HINT | FLAG_WINDOW_RESIZABLE);
    InitWindow(1280, 800, "CChat Desktop");
    SetWindowMinSize(900, 600);
    SetTargetFPS(60);

    AppScreen current_screen = SCREEN_CHAT; // Resume directly into active stage
    AuthState auth = { "x10zxc13@gmail.com", "1223", "Xavi", false };
    ChatState chat = { "Alex", "alex@cchat.io", false, "", { "cybernoxal@gmail.com", "s3553@plc.qld.edu.au" }, 2 };

    int active_field = 0;
    char msg_input[256] = "";
    float backspace_timer = 0.0f;
    float cursor_blink = 0.0f;

    while (!WindowShouldClose()) {
        float sw = GetScreenWidth();
        float sh = GetScreenHeight();
        cursor_blink += GetFrameTime();
        bool show_cursor = ((int)(cursor_blink * 2.5f) % 2) == 0;

        // Input processing
        if (current_screen == SCREEN_LOGIN) {
            HandleTextInput(active_field == 0 ? auth.email : auth.password, 120, &backspace_timer);
        } else if (current_screen == SCREEN_SET_USERNAME) {
            HandleTextInput(auth.username, 120, &backspace_timer);
        } else if (current_screen == SCREEN_CHAT) {
            if (chat.show_new_chat_modal) {
                HandleTextInput(chat.search_query, 120, &backspace_timer);
            } else {
                HandleTextInput(msg_input, 240, &backspace_timer);
            }
        }

        if (IsKeyPressed(KEY_TAB) && current_screen == SCREEN_LOGIN) {
            active_field = (active_field == 0) ? 1 : 0;
        }

        BeginDrawing();
        ClearBackground((Color){11, 15, 23, 255}); // Surface 0 (#0B0F17)

        if (current_screen == SCREEN_CHAT) {
            // Rail Column (Width: 68)
            DrawRectangle(0, 0, 68, sh, (Color){15, 23, 42, 255});
            DrawRectangle(67, 0, 1, sh, (Color){30, 41, 59, 255});

            DrawCircle(34, 40, 20, (Color){37, 99, 235, 255});
            DrawText("C", 27, 28, 22, WHITE);

            // Secondary List Panel (Width: 280)
            DrawRectangle(68, 0, 280, sh, (Color){17, 24, 39, 255});
            DrawRectangle(347, 0, 1, sh, (Color){30, 41, 59, 255});

            DrawText("Messages", 84, 20, 18, (Color){248, 250, 252, 255});

            // New Chat '+' Action Button
            Rectangle add_btn = {308, 16, 28, 28};
            bool add_hover = CheckCollisionPointRec(GetMousePosition(), add_btn);
            DrawRectangleRounded(add_btn, 0.3, 8, add_hover ? (Color){37, 99, 235, 255} : (Color){30, 41, 59, 255});
            DrawText("+", add_btn.x + 8, add_btn.y + 4, 20, WHITE);

            if (add_hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                chat.show_new_chat_modal = true;
                strcpy(chat.search_query, "");
            }

            // Chat Item Row
            Rectangle item_rect = {76, 60, 264, 56};
            DrawRectangleRounded(item_rect, 0.15, 8, (Color){30, 41, 59, 255});
            DrawCircle(104, 88, 16, (Color){37, 99, 235, 255});
            DrawText("A", 99, 79, 16, WHITE);
            DrawText(chat.active_recipient, 130, 72, 14, (Color){248, 250, 252, 255});
            DrawText("Active channel", 130, 90, 12, (Color){148, 163, 184, 255});

            // Main Active Stage Column
            float stage_x = 348;
            float stage_w = sw - stage_x;

            // Header
            DrawRectangle(stage_x, 0, stage_w, 64, (Color){15, 23, 42, 255});
            DrawRectangle(stage_x, 63, stage_w, 1, (Color){30, 41, 59, 255});

            DrawText(chat.active_recipient, stage_x + 24, 16, 16, (Color){248, 250, 252, 255});
            DrawText("Authenticated as:", stage_x + 24, 36, 12, (Color){148, 163, 184, 255});
            DrawText(auth.username, stage_x + 130, 36, 12, (Color){37, 99, 235, 255});

            // Active Message Input Field
            Rectangle input_box = {stage_x + 20, sh - 55, stage_w - 90, 40};
            DrawRectangleRounded(input_box, 0.2, 8, (Color){15, 23, 42, 255});
            DrawRectangleRoundedLines(input_box, 0.2, 8, (Color){30, 41, 59, 255});

            char render_msg[280];
            snprintf(render_msg, sizeof(render_msg), "%s%s", msg_input, (!chat.show_new_chat_modal && show_cursor) ? "_" : "");
            DrawText(strlen(msg_input) > 0 ? render_msg : "Write a message...", input_box.x + 15, input_box.y + 12, 14, strlen(msg_input) > 0 ? (Color){248, 250, 252, 255} : (Color){100, 116, 139, 255});

            // New Chat Modal Overlay (Gmail-style Autofill)
            if (chat.show_new_chat_modal) {
                DrawRectangle(0, 0, sw, sh, (Color){0, 0, 0, 180}); // Dark backdrop

                float m_w = 460;
                float m_h = 320;
                Rectangle modal = {(sw - m_w) / 2, (sh - m_h) / 2, m_w, m_h};

                DrawRectangleRounded(modal, 0.08, 8, (Color){15, 23, 42, 255});
                DrawRectangleRoundedLines(modal, 0.08, 8, (Color){30, 41, 59, 255});

                DrawText("New Conversation", modal.x + 24, modal.y + 20, 18, (Color){248, 250, 252, 255});
                
                // Close button 'x'
                Rectangle close_btn = {modal.x + m_w - 36, modal.y + 18, 20, 20};
                if (CheckCollisionPointRec(GetMousePosition(), close_btn) && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                    chat.show_new_chat_modal = false;
                }
                DrawText("X", close_btn.x + 4, close_btn.y + 2, 14, (Color){148, 163, 184, 255});

                // Recipient Search Input Bar
                Rectangle s_box = {modal.x + 24, modal.y + 55, m_w - 48, 42};
                DrawRectangleRounded(s_box, 0.2, 8, (Color){11, 15, 23, 255});
                DrawRectangleRoundedLines(s_box, 0.2, 8, (Color){37, 99, 235, 255});

                char query_render[140];
                snprintf(query_render, sizeof(query_render), "%s%s", chat.search_query, show_cursor ? "_" : "");
                DrawText(strlen(chat.search_query) > 0 ? query_render : "To: Type email address...", s_box.x + 12, s_box.y + 13, 14, strlen(chat.search_query) > 0 ? WHITE : (Color){100, 116, 139, 255});

                // Autofill Suggestions Dropdown
                DrawText("SUGGESTED CONTACTS", modal.x + 24, modal.y + 112, 11, (Color){100, 116, 139, 255});

                for (int i = 0; i < chat.suggestion_count; i++) {
                    Rectangle sug_item = {modal.x + 24, modal.y + 132 + (i * 44), m_w - 48, 38};
                    bool s_hover = CheckCollisionPointRec(GetMousePosition(), sug_item);
                    DrawRectangleRounded(sug_item, 0.2, 8, s_hover ? (Color){30, 41, 59, 255} : (Color){17, 24, 39, 255});
                    
                    DrawCircle(sug_item.x + 20, sug_item.y + 19, 10, (Color){37, 99, 235, 255});
                    DrawText(chat.suggestions[i], sug_item.x + 40, sug_item.y + 11, 13, (Color){248, 250, 252, 255});

                    if (s_hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                        strcpy(chat.active_recipient, chat.suggestions[i]);
                        chat.show_new_chat_modal = false;
                    }
                }
            }
        }

        EndDrawing();
    }

    CloseWindow();
    curl_global_cleanup();
    return 0;
}
