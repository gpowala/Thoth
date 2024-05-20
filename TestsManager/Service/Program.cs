using Microsoft.AspNetCore.Mvc;
using Service.Data;
using Service.Recording;

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddRazorPages();
builder.Services.AddServerSideBlazor();
//builder.Services.AddSignalR();
builder.Services.AddHttpContextAccessor();
builder.Services.AddSingleton<WeatherForecastService>();
builder.Services.AddSingleton<IRecordingService, RecordingService>();

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

app.MapGet("/recording/start/{guid}", (IRecordingService recording, System.Guid guid) =>
{
    recording.StartSession(guid);

    return Results.Ok();
});

app.MapGet("/recording/stop/{guid}", (IRecordingService recording, System.Guid guid) =>
{
    recording.StopSession(guid);

    return Results.Ok();
});

app.MapPost("/recording/events/click/{guid}/{x}/{y}", async (IRecordingService recording, System.Guid guid, int x, int y, IFormFile clickView) =>
{
    
    using var clickViewStream = new MemoryStream();
    await clickView.CopyToAsync(clickViewStream);

    recording.RegisterClickEvent(guid, x, y, clickViewStream);

    return Results.Ok();
});

app.MapGet("/recording/events/keypress/{guid}/{key}", (IRecordingService recording, System.Guid guid, string key) =>
{
    recording.RegisterKeypressEvent(guid, key);

    return Results.Ok();
});

app.Run();
