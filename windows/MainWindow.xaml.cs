using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace MistyHaze;

public partial class MainWindow : Window
{
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(5) };
    private readonly List<ChatMessage> _history = [];
    private string _mode = "chat";
    private bool _busy;

    // Set MISTY_API_URL before launching the EXE, or replace this default with the deployed Worker URL.
    private readonly string _apiBase = Environment.GetEnvironmentVariable("MISTY_API_URL")?.TrimEnd('/') ?? "http://localhost:8787";

    public MainWindow()
    {
        InitializeComponent();
        SelectMode("chat");
        PromptBox.Focus();
    }

    private void Chat_Click(object sender, RoutedEventArgs e) => SelectMode("chat");
    private void Code_Click(object sender, RoutedEventArgs e) => SelectMode("code");
    private void Agent_Click(object sender, RoutedEventArgs e) => SelectMode("agent");

    private void SelectMode(string mode)
    {
        _mode = mode;
        ChatButton.BorderBrush = mode == "chat" ? (Brush)FindResource("Accent") : new SolidColorBrush(Color.FromRgb(48,45,67));
        CodeButton.BorderBrush = mode == "code" ? (Brush)FindResource("Accent") : new SolidColorBrush(Color.FromRgb(48,45,67));
        AgentButton.BorderBrush = mode == "agent" ? (Brush)FindResource("Accent") : new SolidColorBrush(Color.FromRgb(48,45,67));
        PromptBox.ToolTip = mode == "code" ? "Describe code to build or fix" : mode == "agent" ? "Describe a computer task" : "Ask Misty anything";
    }

    private async void Send_Click(object sender, RoutedEventArgs e) => await SendAsync();

    private async void Prompt_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && Keyboard.Modifiers != ModifierKeys.Shift)
        {
            e.Handled = true;
            await SendAsync();
        }
    }

    private async Task SendAsync()
    {
        if (_busy) return;
        var prompt = PromptBox.Text.Trim();
        if (prompt.Length == 0) return;

        _busy = true;
        StatusText.Text = "● THINKING";
        StatusText.Foreground = (Brush)FindResource("Accent");
        PromptBox.Clear();
        AddBubble("YOU", prompt, false);
        _history.Add(new ChatMessage("user", prompt));
        var assistant = AddBubble("MISTY", "", true);

        try
        {
            var payload = JsonSerializer.Serialize(new { messages = _history, mode = _mode });
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_apiBase}/api/chat")
            {
                Content = new StringContent(payload, Encoding.UTF8, "application/json")
            };
            using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            response.EnsureSuccessStatusCode();
            await using var stream = await response.Content.ReadAsStreamAsync();
            using var reader = new StreamReader(stream);
            var text = new StringBuilder();

            while (await reader.ReadLineAsync() is { } line)
            {
                if (!line.StartsWith("data:", StringComparison.OrdinalIgnoreCase)) continue;
                var data = line[5..].Trim();
                if (data == "[DONE]") continue;
                try
                {
                    using var json = JsonDocument.Parse(data);
                    var root = json.RootElement;
                    var part = root.TryGetProperty("response", out var r) && r.ValueKind == JsonValueKind.String
                        ? r.GetString()
                        : root.TryGetProperty("choices", out var choices) && choices.GetArrayLength() > 0 && choices[0].TryGetProperty("delta", out var delta) && delta.TryGetProperty("content", out var content)
                            ? content.GetString()
                            : null;
                    if (!string.IsNullOrEmpty(part))
                    {
                        text.Append(part);
                        Dispatcher.Invoke(() => assistant.Text = text.ToString());
                    }
                }
                catch (JsonException) { }
            }

            if (text.Length > 0) _history.Add(new ChatMessage("assistant", text.ToString()));
        }
        catch (Exception ex)
        {
            assistant.Text = $"Connection error: {ex.Message}";
        }
        finally
        {
            _busy = false;
            StatusText.Text = "● READY";
            StatusText.Foreground = (Brush)FindResource("Accent2");
            PromptBox.Focus();
        }
    }

    private TextBlock AddBubble(string speaker, string text, bool assistant)
    {
        WelcomeText.Visibility = Visibility.Collapsed;
        var panel = new StackPanel { Margin = new Thickness(4, 0, 4, 16) };
        panel.Children.Add(new TextBlock { Text = speaker, FontSize = 10, Foreground = assistant ? (Brush)FindResource("Accent2") : (Brush)FindResource("Muted"), Margin = new Thickness(3, 0, 0, 5) });
        var bubble = new TextBlock { Text = text, FontSize = 15, TextWrapping = TextWrapping.Wrap, Background = assistant ? (Brush)FindResource("Panel2") : new SolidColorBrush(Color.FromRgb(28,26,40)), Padding = new Thickness(13), MaxWidth = 780 };
        panel.Children.Add(bubble);
        Conversation.Children.Add(panel);
        ConversationScroll.ScrollToEnd();
        return bubble;
    }

    private sealed record ChatMessage(string role, string content);
}
