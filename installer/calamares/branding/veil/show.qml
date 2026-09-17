/* The slideshow while the system copies.
 *
 * Five slides, each an image from branding/generate.py with a heading and a
 * line of text over it, so the words can change without a new picture.
 *
 * Written out slide by slide, in the same slideshow API 1 form Lubuntu 24.04
 * uses, rather than with an inline QML component: that needs a newer Qt than
 * every Calamares build is guaranteed to have, and a slideshow that fails to
 * load is a blank pane for the whole of an install. */
import QtQuick 2.0;
import calamares.slideshow 1.0;

Presentation
{
    id: presentation

    Timer {
        interval: 12000
        running: true
        repeat: true
        onTriggered: presentation.goToNextSlide()
    }

    Slide {
        Image {
            anchors.fill: parent
            fillMode: Image.PreserveAspectCrop
            smooth: true
            source: "slide-1.png"
        }
        Column {
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: 48
            spacing: 10
            width: parent.width - 96
            Text {
                text: qsTr("Welcome to Veil OS")
                color: "#e6ebf2"
                font.pixelSize: 30
                font.weight: Font.DemiBold
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                text: qsTr("A desktop that looks after you: private by default, fast on old hardware, and yours to arrange however you like.")
                color: "#b3bfcd"
                font.pixelSize: 16
                wrapMode: Text.WordWrap
                width: parent.width
            }
        }
    }
    Slide {
        Image {
            anchors.fill: parent
            fillMode: Image.PreserveAspectCrop
            smooth: true
            source: "slide-2.png"
        }
        Column {
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: 48
            spacing: 10
            width: parent.width - 96
            Text {
                text: qsTr("Your Windows programs")
                color: "#e6ebf2"
                font.pixelSize: 30
                font.weight: Font.DemiBold
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                text: qsTr("Wine is built in. Double-click a .exe and it runs. For anything more demanding, Bottles is one click away in the Veil Store.")
                color: "#b3bfcd"
                font.pixelSize: 16
                wrapMode: Text.WordWrap
                width: parent.width
            }
        }
    }
    Slide {
        Image {
            anchors.fill: parent
            fillMode: Image.PreserveAspectCrop
            smooth: true
            source: "slide-3.png"
        }
        Column {
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: 48
            spacing: 10
            width: parent.width - 96
            Text {
                text: qsTr("Games, ready")
                color: "#e6ebf2"
                font.pixelSize: 30
                font.weight: Font.DemiBold
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                text: qsTr("Steam, Lutris, GameMode and MangoHud are installed, with the newest Mesa graphics drivers. NVIDIA drivers are set up on first start.")
                color: "#b3bfcd"
                font.pixelSize: 16
                wrapMode: Text.WordWrap
                width: parent.width
            }
        }
    }
    Slide {
        Image {
            anchors.fill: parent
            fillMode: Image.PreserveAspectCrop
            smooth: true
            source: "slide-4.png"
        }
        Column {
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: 48
            spacing: 10
            width: parent.width - 96
            Text {
                text: qsTr("Make it yours")
                color: "#e6ebf2"
                font.pixelSize: 30
                font.weight: Font.DemiBold
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                text: qsTr("Veil Appearance switches the whole desktop between layouts - Windows-like, macOS-like, or GNOME - and sets colours, blur and wallpaper in one place.")
                color: "#b3bfcd"
                font.pixelSize: 16
                wrapMode: Text.WordWrap
                width: parent.width
            }
        }
    }
    Slide {
        Image {
            anchors.fill: parent
            fillMode: Image.PreserveAspectCrop
            smooth: true
            source: "slide-5.png"
        }
        Column {
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.margins: 48
            spacing: 10
            width: parent.width - 96
            Text {
                text: qsTr("Private by default")
                color: "#e6ebf2"
                font.pixelSize: 30
                font.weight: Font.DemiBold
                wrapMode: Text.WordWrap
                width: parent.width
            }
            Text {
                text: qsTr("Veil Browser blocks trackers and adverts out of the box. There is no telemetry anywhere in the system.")
                color: "#b3bfcd"
                font.pixelSize: 16
                wrapMode: Text.WordWrap
                width: parent.width
            }
        }
    }
}
