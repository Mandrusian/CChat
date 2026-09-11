#include "raylib.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <curl/curl.h>

#define RENDER_URL "https://cchat-backend.onrender.com" // Update to your exact Render URL if different

typedef enum { SCREEN_LOGIN, SCREEN_SET_USERNAME, SCREEN_CHAT } AppScreen;

typedef struct {
    char email[128];
    char password[128];
    char username[128];
    bool is_authenticated;
} AuthState;

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

// Native HTTP POST to Render Backend for Auth
bool Network_Login(const char* email, const char* password) {
    CURL *curl_handle = curl_easy_init();
    if (!curl_handle) return false;

    struct MemoryStruct chunk = { malloc(1), 0 };
    char json_payload[512];
    snprintf(json_payload, sizeof(json_payload), "{\"email\":\"%s\",\"password\":\"%s\"}", email, password);

    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    char full_url[256];
    snprintf(full_url, sizeof(full_url), "%s/api/login", RENDER_URL);

    curl_easy_setopt(curl_handle, CURLOPT_URL, full_url);
    curl_easy_setopt(curl_handle, CURLOPT_POSTFIELDS, json_payload);
    curl_easy_setopt(curl_handle, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl_handle, CURLOPT_WRITEFUNCTION, WriteMemoryCallback);
    curl_easy_setopt(curl_handle, CURLOPT_WRITEDATA, (void *)&chunk);
    curl_easy_setopt(curl_handle, CURLOPT_TIMEOUT, 5L);

    CURLcode res = curl_easy_perform(curl_handle);
    bool success = false;

    if (res == CURLE_OK && chunk.memory) {
        if (strstr(chunk.memory, "\"success\":true")) {
            success = true;
        }
    }

    curl_easy_cleanup(curl_handle);
    curl_slist_free_all(headers);
    if (chunk.memory) free(chunk.memory);

    return success;
}

int main() {
    curl_global_init(CURL_GLOBAL_ALL);
    SetConfigFlags(FLAG_WINDOW_HIGHDPI | FLAG_MSAA_4X_HINT | FLAG_WINDOW_RESIZABLE);
    InitWindow(1280, 800, "CChat Desktop");
    SetWindowMinSize(900, 600);
    SetTargetFPS(60);

    AppScreen current_screen = SCREEN_LOGIN;
    AuthState auth = {0};
    
    int active_field = 0; // 0: Email, 1: Password
    char msg_input[256] = "";
    char error_msg[128] = "";
    bool is_authenticating = false;

    while (!WindowShouldClose()) {
        float sw = GetScreenWidth();
        float sh = GetScreenHeight();

        // Key Input Handling
        int key = GetCharPressed();
        while (key > 0) {
            if ((key >= 32) && (key <= 125)) {
                if (current_screen == SCREEN_LOGIN) {
                    if (active_field == 0 && strlen(auth.email) < 120) {
                        int len = strlen(auth.email);
                        auth.email[len] = (char)key;
                        auth.email[len + 1] = '\0';
                    } else if (active_field == 1 && strlen(auth.password) < 120) {
                        int len = strlen(auth.password);
                        auth.password[len] = (char)key;
                        auth.password[len + 1] = '\0';
                    }
                } else if (current_screen == SCREEN_SET_USERNAME && strlen(auth.username) < 120) {
                    int len = strlen(auth.username);
                    auth.username[len] = (char)key;
                    auth.username[len + 1] = '\0';
                } else if (current_screen == SCREEN_CHAT && strlen(msg_input) < 250) {
                    int len = strlen(msg_input);
                    msg_input[len] = (char)key;
                    msg_input[len + 1] = '\0';
                }
            }
            key = GetCharPressed();
        }

        if (IsKeyPressed(KEY_BACKSPACE)) {
            if (current_screen == SCREEN_LOGIN) {
                if (active_field == 0 && strlen(auth.email) > 0) auth.email[strlen(auth.email) - 1] = '\0';
                if (active_field == 1 && strlen(auth.password) > 0) auth.password[strlen(auth.password) - 1] = '\0';
            } else if (current_screen == SCREEN_SET_USERNAME && strlen(auth.username) > 0) {
                auth.username[strlen(auth.username) - 1] = '\0';
            } else if (current_screen == SCREEN_CHAT && strlen(msg_input) > 0) {
                msg_input[strlen(msg_input) - 1] = '\0';
            }
        }

        if (IsKeyPressed(KEY_TAB) && current_screen == SCREEN_LOGIN) {
            active_field = (active_field == 0) ? 1 : 0;
        }

        BeginDrawing();
        ClearBackground((Color){11, 15, 23, 255}); // #0B0F17

        if (current_screen == SCREEN_LOGIN) {
            // STRICT LOGIN PORTAL CARD
            float card_w = 400;
            float card_h = 400;
            Rectangle card = {(sw - card_w) / 2, (sh - card_h) / 2, card_w, card_h};
            
            DrawRectangleRounded(card, 0.08, 8, (Color){15, 23, 42, 255});
            DrawRectangleRoundedLines(card, 0.08, 8, (Color){30, 41, 59, 255});

            DrawText("Welcome to CChat", card.x + 85, card.y + 35, 24, (Color){248, 250, 252, 255});
            DrawText("Sign in with your account", card.x + 115, card.y + 70, 14, (Color){148, 163, 184, 255});

            // Email Input Field
            Rectangle email_box = {card.x + 30, card.y + 110, 340, 45};
            DrawRectangleRounded(email_box, 0.2, 8, (Color){11, 15, 23, 255});
            DrawRectangleRoundedLines(email_box, 0.2, 8, (active_field == 0) ? (Color){37, 99, 235, 255} : (Color){30, 41, 59, 255});
            DrawText(strlen(auth.email) > 0 ? auth.email : "Email Address", email_box.x + 15, email_box.y + 14, 14, strlen(auth.email) > 0 ? (Color){248, 250, 252, 255} : (Color){100, 116, 139, 255});

            // Password Input Field
            Rectangle pass_box = {card.x + 30, card.y + 175, 340, 45};
            DrawRectangleRounded(pass_box, 0.2, 8, (Color){11, 15, 23, 255});
            DrawRectangleRoundedLines(pass_box, 0.2, 8, (active_field == 1) ? (Color){37, 99, 235, 255} : (Color){30, 41, 59, 255});
            
            char pass_mask[128] = "";
            for (size_t i = 0; i < strlen(auth.password); i++) strcat(pass_mask, "*");
            DrawText(strlen(auth.password) > 0 ? pass_mask : "Password", pass_box.x + 15, pass_box.y + 14, 14, strlen(auth.password) > 0 ? (Color){248, 250, 252, 255} : (Color){100, 116, 139, 255});

            if (strlen(error_msg) > 0) {
                DrawText(error_msg, card.x + 30, card.y + 230, 13, (Color){239, 68, 68, 255});
            }

            // Login Button
            Rectangle btn = {card.x + 30, card.y + 260, 340, 48};
            Vector2 mouse = GetMousePosition();
            bool hover = CheckCollisionPointRec(mouse, btn);
            DrawRectangleRounded(btn, 0.2, 8, hover ? (Color){29, 78, 216, 255} : (Color){37, 99, 235, 255});
            DrawText(is_authenticating ? "Authenticating..." : "Log In", btn.x + (is_authenticating ? 110 : 140), btn.y + 14, 16, (Color){255, 255, 255, 255});

            if (((hover && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) || IsKeyPressed(KEY_ENTER)) && !is_authenticating) {
                if (strlen(auth.email) > 0 && strlen(auth.password) > 0) {
                    is_authenticating = true;
                    // Connect to Render Backend API
                    if (Network_Login(auth.email, auth.password)) {
                        auth.is_authenticated = true;
                        current_screen = SCREEN_SET_USERNAME;
                        strcpy(error_msg, "");
                    } else {
                        strcpy(error_msg, "Invalid credentials or server offline");
                    }
                    is_authenticating = false;
                }
            }

        } else if (current_screen == SCREEN_SET_USERNAME) {
            // SET USERNAME SCREEN ON FIRST LOGIN
            float card_w = 400;
            float card_h = 300;
            Rectangle card = {(sw - card_w) / 2, (sh - card_h) / 2, card_w, card_h};
            
            DrawRectangleRounded(card, 0.08, 8, (Color){15, 23, 42, 255});
            DrawRectangleRoundedLines(card, 0.08, 8, (Color){30, 41, 59, 255});

            DrawText("Choose Display Name", card.x + 80, card.y + 35, 22, (Color){248, 250, 252, 255});
            DrawText("Set your username for CChat", card.x + 105, card.y + 65, 14, (Color){148, 163, 184, 255});

            Rectangle uname_box = {card.x + 30, card.y + 115, 340, 45};
            DrawRectangleRounded(uname_box, 0.2, 8, (Color){11, 15, 23, 255});
            DrawRectangleRoundedLines(uname_box, 0.2, 8, (Color){37, 99, 235, 255});
            DrawText(strlen(auth.username) > 0 ? auth.username : "Enter Username...", uname_box.x + 15, uname_box.y + 14, 14, strlen(auth.username) > 0 ? (Color){248, 250, 252, 255} : (Color){100, 116, 139, 255});

            Rectangle btn = {card.x + 30, card.y + 190, 340, 48};
            DrawRectangleRounded(btn, 0.2, 8, (Color){37, 99, 235, 255});
            DrawText("Continue to CChat", btn.x + 105, btn.y + 14, 16, (Color){255, 255, 255, 255});

            if ((CheckCollisionPointRec(GetMousePosition(), btn) && IsMouseButtonPressed(MOUSE_BUTTON_LEFT)) || IsKeyPressed(KEY_ENTER)) {
                if (strlen(auth.username) > 0) {
                    current_screen = SCREEN_CHAT;
                }
            }

        } else if (current_screen == SCREEN_CHAT) {
            // LIVE CHAT STAGE (NO PREMADE MESSAGES)
            Rectangle rail = {0, 0, 68, sh};
            DrawRectangleRec(rail, (Color){15, 23, 42, 255});
            DrawRectangle(67, 0, 1, sh, (Color){30, 41, 59, 255});

            Rectangle panel = {68, 0, 280, sh};
            DrawRectangleRec(panel, (Color){17, 24, 39, 255});
            DrawRectangle(347, 0, 1, sh, (Color){30, 41, 59, 255});

            DrawText("Conversations", 84, 20, 18, (Color){248, 250, 252, 255});

            // Stage Header
            float stage_x = 348;
            float stage_w = sw - stage_x;
            DrawRectangle(stage_x, 0, stage_w, 64, (Color){15, 23, 42, 255});
            DrawRectangle(stage_x, 63, stage_w, 1, (Color){30, 41, 59, 255});

            DrawText("CChat Live Channel", stage_x + 24, 16, 16, (Color){248, 250, 252, 255});
            DrawText("Authenticated as:", stage_x + 24, 36, 12, (Color){148, 163, 184, 255});
            DrawText(auth.username, stage_x + 130, 36, 12, (Color){37, 99, 235, 255});

            // Message Input Bar
            Rectangle input_box = {stage_x + 20, sh - 55, stage_w - 100, 40};
            DrawRectangleRounded(input_box, 0.2, 8, (Color){15, 23, 42, 255});
            DrawRectangleRoundedLines(input_box, 0.2, 8, (Color){30, 41, 59, 255});
            DrawText(strlen(msg_input) > 0 ? msg_input : "Type a message...", input_box.x + 15, input_box.y + 12, 14, strlen(msg_input) > 0 ? (Color){248, 250, 252, 255} : (Color){100, 116, 139, 255});

            Rectangle send_btn = {stage_x + stage_w - 70, sh - 55, 50, 40};
            DrawRectangleRounded(send_btn, 0.2, 8, (Color){37, 99, 235, 255});
            DrawText("Send", send_btn.x + 8, send_btn.y + 12, 14, (Color){255, 255, 255, 255});
        }

        EndDrawing();
    }

    CloseWindow();
    curl_global_cleanup();
    return 0;
}
