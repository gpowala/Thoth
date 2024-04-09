using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.AspNetCore.Http.HttpResults;

using Service.BrowserAgentCommunication;
using Service.Data;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();
builder.Services.AddServerSideBlazor();
//builder.Services.AddSignalR();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<WeatherForecastService>();
builder.Services.AddSingleton<WebSocketService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();

app.UseStaticFiles();

app.UseRouting();

app.MapBlazorHub();
app.MapFallbackToPage("/_Host");

app.MapPost("/upload-screenshot", async (IFormFile file) =>
{
    
    string tempFilePath = CreateTempFilePath();

    // Save the uploaded file
    using var stream = File.OpenWrite(tempFilePath);
    await file.CopyToAsync(stream);

    // Perform additional actions with the IFormFile
    // (e.g., save to a database, process the file, etc.)

    return Results.Ok();
});

static string CreateTempFilePath()
{
    var filename = $"{Guid.NewGuid()}.tmp";
    var directoryPath = "C:/tests/screenshots";

    if (!Directory.Exists(directoryPath))
        Directory.CreateDirectory(directoryPath);

    return Path.Combine(directoryPath, filename);
}

app.Run();
