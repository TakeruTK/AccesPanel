import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { initialPersonnel } from './ProfilePage';

const VerificationPage = () => {
  const [searchParams] = useSearchParams();
  const [response, setResponse] = useState({ status: 'loading' });

  useEffect(() => {
    const rut = searchParams.get('rut');
    const nombre = searchParams.get('nombre');

    if (!rut || !nombre) {
      setResponse({
        status: 'error',
        message: 'Los parámetros RUT y nombre son obligatorios.',
      });
      return;
    }

    const person = initialPersonnel.find(
      (p) => p.rut === rut && p.nombres.toLowerCase() === nombre.toLowerCase()
    );

    if (!person) {
      setResponse({
        status: 'success',
        found: false,
        message: 'Personal no encontrado.',
      });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalizar a la medianoche para comparar solo la fecha

    const startDate = new Date(person.fechaInicio);
    // Corregir el problema de la zona horaria al interpretar la fecha
    startDate.setMinutes(startDate.getMinutes() + startDate.getTimezoneOffset());
    startDate.setHours(0, 0, 0, 0);

    const endDate = new Date(person.fechaTermino);
    // Corregir el problema de la zona horaria al interpretar la fecha
    endDate.setMinutes(endDate.getMinutes() + endDate.getTimezoneOffset());
    endDate.setHours(0, 0, 0, 0);

    if (today >= startDate && today <= endDate) {
      setResponse({
        status: 'success',
        found: true,
        available: true,
        message: 'Personal disponible para ingresar.',
        data: person,
      });
    } else {
      setResponse({
        status: 'success',
        found: true,
        available: false,
        message: 'El contrato del personal no está activo en la fecha actual.',
        data: person,
      });
    }
  }, [searchParams]);

  return (
    <pre style={{ wordWrap: 'break-word', whiteSpace: 'pre-wrap' }}>
      {JSON.stringify(response, null, 2)}
    </pre>
  );
};

export default VerificationPage;
