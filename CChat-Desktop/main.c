#include "raylib.h"
#include <curl/curl.h>
#include <ctype.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DEFAULT_API_URL "https://cchat-backend-002b.onrender.com"
#define MAX_RESPONSE_BYTES (1024 * 1024)
#define MAX_MESSAGES 64

typedef enum { SCREEN_LOGIN, SCREEN_CHAT } AppScreen;

typedef struct {
    char email[128];
    char password[128];
    char username[64];
    bool is_signup_mode;
} AuthState;

typedef struct {
    char sender[64];
    char text[256];
} ChatMessage;

typedef struct {
    char active_recipient[128];
    char active_recipient_email[128];
    bool show_new_chat_modal;
    char search_query[128];
    char suggestions[5][128];
    int suggestion_count;
    ChatMessage messages[MAX_MESSAGES];
    int message_count;
} ChatState;

struct MemoryStruct {
    char *memory;
    size_t size;
};

static const char *GetApiBaseUrl(void) {
    const char *env_url = getenv("CCHAT_API_URL");
    if (env_url != NULL && env_url[0] != '\0') {
        return env_url;
    }
    return DEFAULT_API_URL;
}

static size_t WriteMemoryCallback(void *contents, size_t size, size_t nmemb, void *userp) {
    if (nmemb > 0 && size > SIZE_MAX / nmemb) {
        return 0;
    }
    size_t realsize = size * nmemb;
    struct MemoryStruct *mem = (struct MemoryStruct *)userp;

    if (realsize > MAX_RESPONSE_BYTES || mem->size > MAX_RESPONSE_BYTES - realsize) {
        return 0;
    }

    char *ptr = realloc(mem->memory, mem->size + realsize + 1);
    if (!ptr) {
        return 0;
    }
    mem->memory = ptr;
    memcpy(&(mem->memory[mem->size]), contents, realsize);
    mem->size += realsize;
    mem->memory[mem->size] = '\0';
    return realsize;
}

static bool JsonEscape(const char *src, char *dst, size_t dst_size) {
    if (!src || !dst || dst_size == 0) {
        return false;
    }
    size_t di = 0;
    for (size_t si = 0; src[si] != '\0'; si++) {
        unsigned char c = (unsigned char)src[si];
        const char *esc = NULL;
        switch (c) {
            case '\"': esc = "\\\""; break;
            case '\\': esc = "\\\\"; break;
            case '\b': esc = "\\b"; break;
            case '\f': esc = "\\f"; break;
            case '\n': esc = "\\n"; break;
            case '\r': esc = "\\r"; break;
            case '\t': esc = "\\t"; break;
            default: break;
        }
        if (esc) {
            size_t elen = strlen(esc);
            if (di + elen >= dst_size) {
                return false;
            }
            memcpy(dst + di, esc, elen);
            di += elen;
        } else if (c < 0x20) {
            if (di + 6 >= dst_size) {
                return false;
            }
            snprintf(dst + di, dst_size - di, "\\u%04x", c);
            di += 6;
        } else {
            if (di + 1 >= dst_size) {
                return false;
            }
            dst[di++] = (char)c;
        }
    }
    dst[di] = '\0';
    return true;
}

static bool ContainsIgnoreCase(const char *haystack, const char *needle) {
    if (!needle || needle[0] == '\0') {
        return true;
    }
    if (!haystack) {
        return false;
    }
    size_t nlen = strlen(needle);
    for (size_t i = 0; haystack[i] != '\0'; i++) {
        size_t j = 0;
        while (j < nlen && haystack[i + j] != '\0' &&
               tolower((unsigned char)haystack[i + j]) == tolower((unsigned char)needle[j])) {
            j++;
        }
        if (j == nlen) {
            return true;
        }
    }
    return false;
}

static char raw_server_log[256] = "Ready";

static bool Network_Auth(const char *username, const char *email, const char *password, bool is_signup) {
    if (!email || email[0] == '\0' || !password || password[0] == '\0') {
        snprintf(raw_server_log, sizeof(raw_server_log), "Email and password are required");
        return false;
    }
    if (is_signup && (!username || username[0] == '\0')) {
        snprintf(raw_server_log, sizeof(raw_server_log), "Username is required to sign up");
        return false;
    }

    char esc_email[256];
    char esc_password[256];
    char esc_username[128];
    if (!JsonEscape(email, esc_email, sizeof(esc_email)) ||
        !JsonEscape(password, esc_password, sizeof(esc_password)) ||
        (is_signup && !JsonEscape(username, esc_username, sizeof(esc_username)))) {
        snprintf(raw_server_log, sizeof(raw_server_log), "Input exceeds payload buffer");
        return false;
    }

    CURL *curl_handle = curl_easy_init();
    if (!curl_handle) {
        snprintf(raw_server_log, sizeof(raw_server_log), "Failed to initialize HTTP client");
        return false;
    }

    struct MemoryStruct chunk = { calloc(1, 1), 0 };
    if (!chunk.memory) {
        curl_easy_cleanup(curl_handle);
        snprintf(raw_server_log, sizeof(raw_server_log), "Out of memory");
        return false;
    }

    char json_payload[1024];
    if (is_signup) {
        snprintf(
            json_payload,
            sizeof(json_payload),
            "{\"username\":\"%s\",\"email\":\"%s\",\"password\":\"%s\"}",
            esc_username,
            esc_email,
            esc_password
        );
    } else {
        snprintf(
            json_payload,
            sizeof(json_payload),
            "{\"email\":\"%s\",\"password\":\"%s\"}",
            esc_email,
            esc_password
        );
    }

    struct curl_slist *headers = curl_slist_append(NULL, "Content-Type: application/json");

    char full_url[512];
    snprintf(full_url, sizeof(full_url), "%s/api/%s", GetApiBaseUrl(), is_signup ? "register" : "login");

    curl_easy_setopt(curl_handle, CURLOPT_URL, full_url);
    curl_easy_setopt(curl_handle, CURLOPT_POSTFIELDS, json_payload);
    curl_easy_setopt(curl_handle, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl_handle, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl_handle, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(curl_handle, CURLOPT_SSL_VERIFYHOST, 2L);
    curl_easy_setopt(curl_handle, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
    curl_easy_setopt(curl_handle, CURLOPT_WRITEDATA, (void *)&chunk);
    curl_easy_setopt(curl_handle, CURLOPT_TIMEOUT, 10L);

    CURLcode res = curl_easy_perform(curl_handle);
    long status_code = 0;
    curl_easy_getinfo(curl_handle, CURLINFO_RESPONSE_CODE, &status_code);

    bool success = false;
    if (res == CURLE_OK && chunk.memory) {
        if (status_code >= 200 && status_code < 300 && strstr(chunk.memory, "\"user\"") != NULL) {
            success = true;
            snprintf(raw_server_log, sizeof(raw_server_log), "Authenticated (%ld)", status_code);
        } else {
            snprintf(raw_server_log, sizeof(raw_server_log), "Auth failed (%ld): %.200s", status_code, chunk.memory);
        }
    } else {
        snprintf(raw_server_log, sizeof(raw_server_log), "Network error: %s", curl_easy_strerror(res));
    }

    curl_easy_cleanup(curl_handle);
    curl_slist_free_all(headers);
    free(chunk.memory);

    return success;
}

static void HandleTextInput(char *buffer, int max_len, float *backspace_timer) {
    if (!buffer || max_len <= 1) {
        return;
    }

    int key = GetCharPressed();
    while (key > 0) {
        int len = (int)strlen(buffer);
        if (key >= 32 && key <= 126 && len < max_len - 1) {
            buffer[len] = (char)key;
            buffer[len + 1] = '\0';
        }
        key = GetCharPressed();
    }

    if (IsKeyDown(KEY_BACKSPACE)) {
        *backspace_timer += GetFrameTime();
        if (IsKeyPressed(KEY_BACKSPACE) || *backspace_timer > 0.3f) {
            int len = (int)strlen(buffer);
            if (len > 0) {
                buffer[len - 1] = '\0';
            }
            if (*backspace_timer > 0.3f) {
                *backspace_timer = 0.25f;
            }
        }
    } else {
        *backspace_timer = 0.0f;
    }
}

static void AppendMessage(ChatState *chat, const char *sender, const char *text) {
    if (!chat || !text || text[0] == '\0') {
        return;
    }
    if (chat->message_count >= MAX_MESSAGES) {
        memmove(&chat->messages[0], &chat->messages[1], sizeof(ChatMessage) * (MAX_MESSAGES - 1));
        chat->message_count = MAX_MESSAGES - 1;
    }
    ChatMessage *msg = &chat->messages[chat->message_count++];
    snprintf(msg->sender, sizeof(msg->sender), "%s", sender ? sender : "You");
    snprintf(msg->text, sizeof(msg->text), "%s", text);
}

static void MaskPassword(const char *password, char *masked, size_t masked_size) {
    size_t len = strlen(password);
    if (len >= masked_size) {
        len = masked_size - 1;
    }
    memset(masked, '*', len);
    masked[len] = '\0';
}

int main(void) {
    curl_global_init(CURL_GLOBAL_ALL);
    SetConfigFlags(FLAG_WINDOW_HIGHDPI | FLAG_MSAA_4X_HINT | FLAG_WINDOW_RESIZABLE);
    InitWindow(1280, 800, "CChat Desktop");
    SetWindowMinSize(900, 600);
    SetTargetFPS(60);

    AppScreen current_screen = SCREEN_LOGIN;
    AuthState auth = { "", "", "", false };
    ChatState chat = {
        "General",
        "general@cchat.local",
        false,
        "",
        { "alice@example.com", "bob@example.com", "team@example.com" },
        3,
        { { "CChat", "Welcome to CChat Desktop. Sign in or start a conversation." } },
        1
    };

    int active_field = 0; // 0 = email, 1 = password, 2 = username (signup)
    char msg_input[256] = "";
    float backspace_timer = 0.0f;
    float cursor_blink = 0.0f;

    while (!WindowShouldClose()) {
        float sw = (float)GetScreenWidth();
        float sh = (float)GetScreenHeight();
        cursor_blink += GetFrameTime();
        bool show_cursor = ((int)(cursor_blink * 2.5f) % 2) == 0;

        if (current_screen == SCREEN_LOGIN) {
            if (active_field == 0) {
                HandleTextInput(auth.email, (int)sizeof(auth.email), &backspace_timer);
            } else if (active_field == 1) {
                HandleTextInput(auth.password, (int)sizeof(auth.password), &backspace_timer);
            } else {
                HandleTextInput(auth.username, (int)sizeof(auth.username), &backspace_timer);
            }

            if (IsKeyPressed(KEY_TAB)) {
                int field_count = auth.is_signup_mode ? 3 : 2;
                active_field = (active_field + 1) % field_count;
            }
        } else if (current_screen == SCREEN_CHAT) {
            if (chat.show_new_chat_modal) {
                HandleTextInput(chat.search_query, (int)sizeof(chat.search_query), &backspace_timer);
                if (IsKeyPressed(KEY_ESCAPE)) {
                    chat.show_new_chat_modal = false;
                } else if (IsKeyPressed(KEY_ENTER) && chat.search_query[0] != '\0') {
                    snprintf(chat.active_recipient, sizeof(chat.active_recipient), "%s", chat.search_query);
                    snprintf(chat.active_recipient_email, sizeof(chat.active_recipient_email), "%s", chat.search_query);
                    chat.show_new_chat_modal = false;
                }
            } else {
                HandleTextInput(msg_input, (int)sizeof(msg_input), &backspace_timer);
                if (IsKeyPressed(KEY_ENTER) && msg_input[0] != '\0') {
                    const char *sender = auth.username[0] != '\0' ? auth.username : auth.email;
                    AppendMessage(&chat, sender[0] != '\0' ? sender : "You", msg_input);
                    msg_input[0] = '\0';
                }
            }
        }

        BeginDrawing();
        ClearBackground((Color){11, 15, 23, 255});

        if (current_screen == SCREEN_LOGIN) {
            float card_w = 420.0f;
            float card_h = auth.is_signup_mode ? 430.0f : 360.0f;
            Rectangle card = { (sw - card_w) / 2.0f, (sh - card_h) / 2.0f, card_w, card_h };

            DrawRectangleRounded(card, 0.06f, 8, (Color){15, 23, 42, 255});
            DrawRectangleRoundedLines(card, 0.06f, 8, (Color){30, 41, 59, 255});

            DrawText(auth.is_signup_mode ? "Create CChat Account" : "Sign in to CChat",
                     (int)(card.x + 28), (int)(card.y + 24), 22, (Color){248, 250, 252, 255});

            float y = card.y + 72.0f;

            if (auth.is_signup_mode) {
                Rectangle user_box = { card.x + 28, y, card_w - 56, 42 };
                if (CheckCollisionPointRec(GetMousePosition(), user_box) && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                    active_field = 2;
                }
                DrawRectangleRounded(user_box, 0.18f, 8, (Color){11, 15, 23, 255});
                DrawRectangleRoundedLines(user_box, 0.18f, 8,
                    active_field == 2 ? (Color){37, 99, 235, 255} : (Color){30, 41, 59, 255});
                char u_buf[80];
                snprintf(u_buf, sizeof(u_buf), "%s%s", auth.username, (active_field == 2 && show_cursor) ? "_" : "");
                DrawText(auth.username[0] ? u_buf : "Username",
                         (int)(user_box.x + 12), (int)(user_box.y + 13), 14,
                         auth.username[0] ? WHITE : (Color){100, 116, 139, 255});
                y += 58.0f;
            }

            Rectangle email_box = { card.x + 28, y, card_w - 56, 42 };
            if (CheckCollisionPointRec(GetMousePosition(), email_box) && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                active_field = 0;
            }
            DrawRectangleRounded(email_box, 0.18f, 8, (Color){11, 15, 23, 255});
            DrawRectangleRoundedLines(email_box, 0.18f, 8,
                active_field == 0 ? (Color){37, 99, 235, 255} : (Color){30, 41, 59, 255});
            char e_buf[144];
            snprintf(e_buf, sizeof(e_buf), "%s%s", auth.email, (active_field == 0 && show_cursor) ? "_" : "");
            DrawText(auth.email[0] ? e_buf : "Email address",
                     (int)(email_box.x + 12), (int)(email_box.y + 13), 14,
                     auth.email[0] ? WHITE : (Color){100, 116, 139, 255});
            y += 58.0f;

            Rectangle pass_box = { card.x + 28, y, card_w - 56, 42 };
            if (CheckCollisionPointRec(GetMousePosition(), pass_box) && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                active_field = 1;
            }
            DrawRectangleRounded(pass_box, 0.18f, 8, (Color){11, 15, 23, 255});
            DrawRectangleRoundedLines(pass_box, 0.18f, 8,
                active_field == 1 ? (Color){37, 99, 235, 255} : (Color){30, 41, 59, 255});
            char masked[128];
            MaskPassword(auth.password, masked, sizeof(masked));
            char p_buf[144];
            snprintf(p_buf, sizeof(p_buf), "%s%s", masked, (active_field == 1 && show_cursor) ? "_" : "");
            DrawText(auth.password[0] ? p_buf : "Password",
                     (int)(pass_box.x + 12), (int)(pass_box.y + 13), 14,
                     auth.password[0] ? WHITE : (Color){100, 116, 139, 255});
            y += 62.0f;

            Rectangle submit_btn = { card.x + 28, y, card_w - 56, 44 };
            bool submit_hover = CheckCollisionPointRec(GetMousePosition(), submit_btn);
            DrawRectangleRounded(submit_btn, 0.2f, 8, submit_hover ? (Color){59, 130, 246, 255} : (Color){37, 99, 235, 255});
            DrawText(auth.is_signup_mode ? "Create Account" : "Sign In",
                     (int)(submit_btn.x + 140), (int)(submit_btn.y + 13), 16, WHITE);

            bool submit_triggered = IsKeyPressed(KEY_ENTER) ||
                                    (submit_hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT));
            if (submit_triggered) {
                if (Network_Auth(auth.username, auth.email, auth.password, auth.is_signup_mode)) {
                    if (auth.username[0] == '\0') {
                        snprintf(auth.username, sizeof(auth.username), "%s", auth.email);
                    }
                    current_screen = SCREEN_CHAT;
                }
            }
            y += 56.0f;

            Rectangle toggle_btn = { card.x + 28, y, card_w - 56, 28 };
            bool toggle_hover = CheckCollisionPointRec(GetMousePosition(), toggle_btn);
            DrawText(auth.is_signup_mode ? "Already have an account? Sign in" : "Need an account? Sign up",
                     (int)toggle_btn.x, (int)toggle_btn.y + 4, 13,
                     toggle_hover ? WHITE : (Color){148, 163, 184, 255});
            if (toggle_hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                auth.is_signup_mode = !auth.is_signup_mode;
                active_field = 0;
            }

            DrawText(raw_server_log, (int)(card.x + 28), (int)(card.y + card_h - 28), 11, (Color){148, 163, 184, 255});
        } else if (current_screen == SCREEN_CHAT) {
            // Rail Column (Width: 68)
            DrawRectangle(0, 0, 68, (int)sh, (Color){15, 23, 42, 255});
            DrawRectangle(67, 0, 1, (int)sh, (Color){30, 41, 59, 255});

            DrawCircle(34, 40, 20, (Color){37, 99, 235, 255});
            DrawText("C", 27, 28, 22, WHITE);

            Rectangle logout_btn = { 12, (int)sh - 52, 44, 32 };
            bool logout_hover = CheckCollisionPointRec(GetMousePosition(), logout_btn);
            DrawRectangleRounded(logout_btn, 0.25f, 6, logout_hover ? (Color){220, 38, 38, 255} : (Color){30, 41, 59, 255});
            DrawText("Out", (int)logout_btn.x + 9, (int)logout_btn.y + 9, 12, WHITE);
            if (logout_hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                auth.password[0] = '\0';
                current_screen = SCREEN_LOGIN;
            }

            // Secondary List Panel (Width: 280)
            DrawRectangle(68, 0, 280, (int)sh, (Color){17, 24, 39, 255});
            DrawRectangle(347, 0, 1, (int)sh, (Color){30, 41, 59, 255});

            DrawText("Messages", 84, 20, 18, (Color){248, 250, 252, 255});

            // New Chat '+' Action Button
            Rectangle add_btn = { 308, 16, 28, 28 };
            bool add_hover = CheckCollisionPointRec(GetMousePosition(), add_btn);
            DrawRectangleRounded(add_btn, 0.3f, 8, add_hover ? (Color){37, 99, 235, 255} : (Color){30, 41, 59, 255});
            DrawText("+", (int)(add_btn.x + 8), (int)(add_btn.y + 4), 20, WHITE);

            if (add_hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                chat.show_new_chat_modal = true;
                chat.search_query[0] = '\0';
            }

            // Chat Item Row
            Rectangle item_rect = { 76, 60, 264, 56 };
            DrawRectangleRounded(item_rect, 0.15f, 8, (Color){30, 41, 59, 255});
            DrawCircle(104, 88, 16, (Color){37, 99, 235, 255});
            char initial[2] = { chat.active_recipient[0] ? (char)toupper((unsigned char)chat.active_recipient[0]) : 'C', '\0' };
            DrawText(initial, 99, 79, 16, WHITE);
            DrawText(chat.active_recipient, 130, 72, 14, (Color){248, 250, 252, 255});
            DrawText("Active channel", 130, 90, 12, (Color){148, 163, 184, 255});

            // Main Active Stage Column
            float stage_x = 348.0f;
            float stage_w = sw - stage_x;

            // Header
            DrawRectangle((int)stage_x, 0, (int)stage_w, 64, (Color){15, 23, 42, 255});
            DrawRectangle((int)stage_x, 63, (int)stage_w, 1, (Color){30, 41, 59, 255});

            DrawText(chat.active_recipient, (int)(stage_x + 24), 16, 16, (Color){248, 250, 252, 255});
            DrawText("Authenticated as:", (int)(stage_x + 24), 36, 12, (Color){148, 163, 184, 255});
            const char *display_user = auth.username[0] ? auth.username : (auth.email[0] ? auth.email : "Guest");
            DrawText(display_user, (int)(stage_x + 138), 36, 12, (Color){37, 99, 235, 255});

            // Message feed
            float msg_y = 84.0f;
            float max_msg_y = sh - 75.0f;
            for (int i = 0; i < chat.message_count && msg_y < max_msg_y; i++) {
                DrawText(chat.messages[i].sender, (int)(stage_x + 24), (int)msg_y, 12, (Color){96, 165, 250, 255});
                DrawText(chat.messages[i].text, (int)(stage_x + 24), (int)(msg_y + 16), 14, (Color){248, 250, 252, 255});
                msg_y += 44.0f;
            }

            // Active Message Input Field
            Rectangle input_box = { stage_x + 20, sh - 55, stage_w - 40, 40 };
            DrawRectangleRounded(input_box, 0.2f, 8, (Color){15, 23, 42, 255});
            DrawRectangleRoundedLines(input_box, 0.2f, 8, (Color){30, 41, 59, 255});

            char render_msg[280];
            snprintf(render_msg, sizeof(render_msg), "%s%s", msg_input, (!chat.show_new_chat_modal && show_cursor) ? "_" : "");
            DrawText(msg_input[0] != '\0' ? render_msg : "Write a message... (Enter to send)",
                     (int)(input_box.x + 15), (int)(input_box.y + 12), 14,
                     msg_input[0] != '\0' ? (Color){248, 250, 252, 255} : (Color){100, 116, 139, 255});

            // New Chat Modal Overlay
            if (chat.show_new_chat_modal) {
                DrawRectangle(0, 0, (int)sw, (int)sh, (Color){0, 0, 0, 180});

                float m_w = 460.0f;
                float m_h = 320.0f;
                Rectangle modal = { (sw - m_w) / 2.0f, (sh - m_h) / 2.0f, m_w, m_h };

                DrawRectangleRounded(modal, 0.08f, 8, (Color){15, 23, 42, 255});
                DrawRectangleRoundedLines(modal, 0.08f, 8, (Color){30, 41, 59, 255});

                DrawText("New Conversation", (int)(modal.x + 24), (int)(modal.y + 20), 18, (Color){248, 250, 252, 255});

                Rectangle close_btn = { modal.x + m_w - 36, modal.y + 18, 20, 20 };
                if (CheckCollisionPointRec(GetMousePosition(), close_btn) && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                    chat.show_new_chat_modal = false;
                }
                DrawText("X", (int)(close_btn.x + 4), (int)(close_btn.y + 2), 14, (Color){148, 163, 184, 255});

                Rectangle s_box = { modal.x + 24, modal.y + 55, m_w - 48, 42 };
                DrawRectangleRounded(s_box, 0.2f, 8, (Color){11, 15, 23, 255});
                DrawRectangleRoundedLines(s_box, 0.2f, 8, (Color){37, 99, 235, 255});

                char query_render[140];
                snprintf(query_render, sizeof(query_render), "%s%s", chat.search_query, show_cursor ? "_" : "");
                DrawText(chat.search_query[0] != '\0' ? query_render : "To: Type email address...",
                         (int)(s_box.x + 12), (int)(s_box.y + 13), 14,
                         chat.search_query[0] != '\0' ? WHITE : (Color){100, 116, 139, 255});

                DrawText("SUGGESTED CONTACTS", (int)(modal.x + 24), (int)(modal.y + 112), 11, (Color){100, 116, 139, 255});

                int row = 0;
                for (int i = 0; i < chat.suggestion_count; i++) {
                    if (!ContainsIgnoreCase(chat.suggestions[i], chat.search_query)) {
                        continue;
                    }
                    Rectangle sug_item = { modal.x + 24, modal.y + 132 + (row * 44.0f), m_w - 48, 38 };
                    bool s_hover = CheckCollisionPointRec(GetMousePosition(), sug_item);
                    DrawRectangleRounded(sug_item, 0.2f, 8, s_hover ? (Color){30, 41, 59, 255} : (Color){17, 24, 39, 255});

                    DrawCircle((int)(sug_item.x + 20), (int)(sug_item.y + 19), 10, (Color){37, 99, 235, 255});
                    DrawText(chat.suggestions[i], (int)(sug_item.x + 40), (int)(sug_item.y + 11), 13, (Color){248, 250, 252, 255});

                    if (s_hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) {
                        snprintf(chat.active_recipient, sizeof(chat.active_recipient), "%s", chat.suggestions[i]);
                        snprintf(chat.active_recipient_email, sizeof(chat.active_recipient_email), "%s", chat.suggestions[i]);
                        chat.show_new_chat_modal = false;
                    }
                    row++;
                }
            }
        }

        EndDrawing();
    }

    CloseWindow();
    curl_global_cleanup();
    return 0;
}
