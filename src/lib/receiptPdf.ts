import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type { LoanRecord, UserPublic } from '../../shared/types.ts';
import { formatDateFr } from './api.ts';

export async function generateLoanReceiptPdf(loan: LoanRecord, user: UserPublic): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  let currentY = 15;

  // En-tête institutionnel
  doc.setFillColor(20, 70, 40); // Vert émeraude sombre EST
  doc.rect(0, 0, pageWidth, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('BIBLIOTHÈQUE BIBLIOEST · EST FÈS (USMBA)', 14, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Reçu officiel de prêt et justificatif d’emprunt d’ouvrage', 14, 18);

  currentY = 34;

  // Informations du reçu
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('BULLETIN DE PRÊT D’OUVRAGE', 14, currentY);

  currentY += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Identifiant de prêt : ${loan.id}`, 14, currentY);
  currentY += 6;
  doc.text(`Date d’émission : ${new Date().toLocaleDateString('fr-FR')}`, 14, currentY);
  currentY += 10;

  // Bloc Emprunteur (Gmail académique)
  doc.setFillColor(245, 247, 245);
  doc.roundedRect(14, currentY, pageWidth - 28, 28, 2, 2, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 70, 40);
  doc.text('INFORMATIONS MEMBRE (COMPTE UNIVERSITAIRE)', 18, currentY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(50, 50, 50);
  doc.text(`Nom et Prénom : ${user.fullName}`, 18, currentY + 13);
  doc.text(`E-mail académique : ${user.email}`, 18, currentY + 19);
  doc.text(`Établissement / Filière : ${user.institution} ${user.filiere ? `· ${user.filiere}` : ''}`, 18, currentY + 25);

  currentY += 34;

  // Bloc Ouvrage & Exemplaire
  doc.setFillColor(245, 247, 245);
  doc.roundedRect(14, currentY, pageWidth - 28, 42, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(20, 70, 40);
  doc.text('DÉTAILS DE L’OUVRAGE ET DE L’EXEMPLAIRE', 18, currentY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(50, 50, 50);
  doc.text(`Titre : ${loan.bookTitle}`, 18, currentY + 13);
  doc.text(`Auteurs : ${loan.bookAuthors}`, 18, currentY + 19);
  doc.text(`Code-barres exemplaire : ${loan.copyBarcode}`, 18, currentY + 25);
  doc.text(`Emplacement rayon : ${loan.shelfLocation}`, 18, currentY + 31);
  doc.text(`Date d’emprunt : ${formatDateFr(loan.borrowedAt)}  |  Échéance de retour : ${formatDateFr(loan.dueAt)}`, 18, currentY + 37);

  currentY += 50;

  // QR Code de l'exemplaire scannable
  const qrPayload = JSON.stringify({
    type: 'BIBLIOEST_COPY',
    loanId: loan.id,
    bookTitle: loan.bookTitle,
    copyBarcode: loan.copyBarcode,
    shelfLocation: loan.shelfLocation,
    memberName: user.fullName,
    memberEmail: user.email,
    dueAt: loan.dueAt,
  });

  try {
    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      width: 250,
      margin: 1,
      color: { dark: '#144628', light: '#ffffff' },
    });

    // Encadré QR Code à droite
    const qrBoxX = pageWidth - 64;
    const qrBoxY = currentY;
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.3);
    doc.setDrawColor(200, 200, 200);
    doc.roundedRect(qrBoxX - 4, qrBoxY - 4, 54, 58, 2, 2, 'FD');

    doc.addImage(qrDataUrl, 'PNG', qrBoxX, qrBoxY, 46, 46);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(20, 70, 40);
    doc.text('QR Code Exemplaire', qrBoxX + 3, qrBoxY + 50);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(100, 100, 100);
    doc.text('Scannez pour info', qrBoxX + 7, qrBoxY + 54);

    // Texte explicatif à gauche
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text('Instructions et Conditions de Prêt', 14, currentY + 6);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(70, 70, 70);
    const instructions = [
      '1. La durée réglementaire de prêt est de 7 jours calendaires.',
      '2. Tout retard entraîne un blocage temporaire des nouveaux emprunts.',
      '3. Le QR Code ci-contre encode l’identifiant de l’exemplaire, le code-barres',
      '    et les informations de prêt vérifiables par la bibliothèque.',
      '4. Conservez ce reçu numérique dans votre boîte e-mail académique.',
    ];
    let instrY = currentY + 13;
    for (const line of instructions) {
      doc.text(line, 14, instrY);
      instrY += 5;
    }
  } catch (err) {
    console.error('Erreur génération QR Code PDF:', err);
  }

  currentY += 66;

  // Bas de page
  doc.setLineWidth(0.2);
  doc.setDrawColor(220, 220, 220);
  doc.line(14, currentY, pageWidth - 14, currentY);

  currentY += 6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('Bibliothèque BiblioEST · École Supérieure de Technologie de Fès · Université Sidi Mohamed Ben Abdellah', 14, currentY);
  doc.text(`Document généré automatiquement le ${new Date().toLocaleString('fr-FR')}`, 14, currentY + 4);

  // Télécharger le fichier PDF
  const safeBarcode = loan.copyBarcode.replace(/[^a-zA-Z0-9_-]/g, '_');
  doc.save(`Recu_Pret_BiblioEST_${safeBarcode}.pdf`);
}
